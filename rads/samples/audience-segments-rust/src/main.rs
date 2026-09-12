use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordsFile {
    algorithm_id: String,
    records: Vec<Record>,
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
    let mut tiers: HashMap<String, usize> =
        [("low", 0), ("medium", 0), ("high", 0)].map(|(k, v)| (k.to_string(), v)).into();
    let mut connections_sum = 0usize;

    for rec in records {
        let weeks = rec.data.engagement.len().max(1) as f64;
        let mean_minutes =
            rec.data.engagement.iter().map(|e| e.minutes_active).sum::<f64>() / weeks;
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

fn load_records(path: &str) -> Result<(String, Vec<Record>), String> {
    let body = std::fs::read_to_string(path).map_err(|e| format!("read {path} failed: {e}"))?;
    let file: RecordsFile =
        serde_json::from_str(&body).map_err(|e| format!("parse {path} failed: {e}"))?;
    Ok((file.algorithm_id, file.records))
}

fn write_result(result: &Output) -> Result<(), String> {
    let out =
        serde_json::to_string(result).map_err(|e| format!("serialize result failed: {e}"))?;
    match std::env::var("RESULT_PATH") {
        Ok(path) if !path.is_empty() => {
            std::fs::write(&path, out).map_err(|e| format!("write {path} failed: {e}"))
        }
        _ => {
            println!("{out}");
            Ok(())
        }
    }
}

fn main() {
    let records_path = std::env::var("RECORDS_PATH").expect("RECORDS_PATH is required");

    let (algorithm_id, records) = load_records(&records_path).expect("load records");
    eprintln!("loaded {} records from {records_path}", records.len());

    write_result(&analyze(&algorithm_id, &records)).expect("write result");
}