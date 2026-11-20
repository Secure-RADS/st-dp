mod gen;

use gen::sce::v1::data_access_client::DataAccessClient;
use gen::sce::v1::{FetchRecordsRequest, SubmitResultRequest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tonic::transport::{Endpoint, Uri};
use tower::service_fn;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct Engagement {
    week: String,
    posts: u64,
    likes_given: u64,
    likes_received: u64,
    comments: u64,
    minutes_active: f64,
}

#[derive(Deserialize)]
struct Data {
    interests: Vec<String>,
    connections: Vec<String>,
    engagement: Vec<Engagement>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct Record {
    record_id: String,
    data: Data,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    interest: String,
    users: usize,
    avg_weekly_minutes: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    algorithm_id: String,
    user_count: usize,
    segments: Vec<Segment>,
    engagement_tiers: HashMap<String, usize>,
    avg_connections: f64,
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn analyze(algorithm_id: &str, records: &[Record]) -> Output {
    let mut per_interest: HashMap<&str, (usize, f64)> = HashMap::new();
    let mut tiers: HashMap<String, usize> = [("low", 0), ("medium", 0), ("high", 0)]
        .map(|(k, v)| (k.to_string(), v))
        .into();
    let mut connections_sum = 0usize;

    for rec in records {
        let weeks = rec.data.engagement.len().max(1) as f64;
        let mean_minutes = rec
            .data
            .engagement
            .iter()
            .map(|e| e.minutes_active)
            .sum::<f64>()
            / weeks;
        let tier = if mean_minutes < 30.0 {
            "low"
        } else if mean_minutes <= 120.0 {
            "medium"
        } else {
            "high"
        };
        *tiers.get_mut(tier).unwrap() += 1;
        connections_sum += rec.data.connections.len();
        for interest in &rec.data.interests {
            let entry = per_interest.entry(interest).or_insert((0, 0.0));
            entry.0 += 1;
            entry.1 += mean_minutes;
        }
    }

    let mut segments: Vec<Segment> = per_interest
        .into_iter()
        .map(|(interest, (users, minutes_sum))| Segment {
            interest: interest.to_string(),
            users,
            avg_weekly_minutes: round2(minutes_sum / users as f64),
        })
        .collect();
    segments.sort_by(|a, b| b.users.cmp(&a.users).then(a.interest.cmp(&b.interest)));
    segments.truncate(10);

    let n = records.len();
    Output {
        algorithm_id: algorithm_id.to_string(),
        user_count: n,
        segments,
        engagement_tiers: tiers,
        avg_connections: round2(connections_sum as f64 / n as f64),
    }
}

fn value_to_json(value: &prost_types::Value) -> serde_json::Value {
    use prost_types::value::Kind;
    match value.kind.as_ref() {
        Some(Kind::NullValue(_)) => serde_json::Value::Null,
        Some(Kind::NumberValue(n)) => serde_json::Number::from_f64(*n)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Some(Kind::StringValue(s)) => serde_json::Value::String(s.clone()),
        Some(Kind::BoolValue(b)) => serde_json::Value::Bool(*b),
        Some(Kind::StructValue(s)) => struct_to_json(s),
        Some(Kind::ListValue(l)) => {
            serde_json::Value::Array(l.values.iter().map(value_to_json).collect())
        }
        None => serde_json::Value::Null,
    }
}

fn struct_to_json(value: &prost_types::Struct) -> serde_json::Value {
    serde_json::Value::Object(
        value
            .fields
            .iter()
            .map(|(k, v)| (k.clone(), value_to_json(v)))
            .collect(),
    )
}

fn json_to_value(value: &serde_json::Value) -> prost_types::Value {
    use prost_types::value::Kind;
    let kind = match value {
        serde_json::Value::Null => Kind::NullValue(0),
        serde_json::Value::Bool(b) => Kind::BoolValue(*b),
        serde_json::Value::Number(n) => Kind::NumberValue(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::String(s) => Kind::StringValue(s.clone()),
        serde_json::Value::Array(items) => Kind::ListValue(prost_types::ListValue {
            values: items.iter().map(json_to_value).collect(),
        }),
        serde_json::Value::Object(_) => Kind::StructValue(json_to_struct(value)),
    };
    prost_types::Value { kind: Some(kind) }
}

fn json_to_struct(value: &serde_json::Value) -> prost_types::Struct {
    let fields = match value {
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(k, v)| (k.clone(), json_to_value(v)))
            .collect(),
        _ => Default::default(),
    };
    prost_types::Struct { fields }
}

async fn channel(socket_path: &str) -> Result<tonic::transport::Channel, String> {
    let path = socket_path.to_string();
    Endpoint::try_from("http://[::]:50051")
        .map_err(|e| format!("build endpoint: {e}"))?
        .connect_with_connector(service_fn(move |_: Uri| {
            let path = path.clone();
            async move {
                let stream = tokio::net::UnixStream::connect(path).await?;
                Ok::<_, std::io::Error>(hyper_util::rt::TokioIo::new(stream))
            }
        }))
        .await
        .map_err(|e| format!("connect {socket_path}: {e}"))
}

#[tokio::main]
async fn main() {
    let socket_path = std::env::var("SCE_RPC_SOCKET").expect("SCE_RPC_SOCKET is required");
    let algorithm_id = std::env::var("ALGORITHM_ID").expect("ALGORITHM_ID is required");

    let channel = channel(&socket_path).await.expect("connect to sce-unit");
    let mut client = DataAccessClient::new(channel);

    let mut stream = client
        .fetch_records(FetchRecordsRequest {})
        .await
        .expect("fetch records")
        .into_inner();

    let mut records: Vec<Record> = Vec::new();
    while let Some(record) = stream.message().await.expect("receive record") {
        let data = record
            .data
            .as_ref()
            .map(struct_to_json)
            .unwrap_or(serde_json::Value::Object(Default::default()));
        let data: Data = serde_json::from_value(data).expect("decode record");
        records.push(Record {
            record_id: record.record_id,
            data,
        });
    }
    eprintln!("loaded {} records over {socket_path}", records.len());

    let result = analyze(&algorithm_id, &records);
    let payload = serde_json::to_value(&result).expect("serialize result");
    client
        .submit_result(SubmitResultRequest {
            result: Some(json_to_struct(&payload)),
        })
        .await
        .expect("submit result");
}
