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
struct Page {
    algorithm_id: String,
    records: Vec<Record>,
    next_cursor: Option<String>,
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

fn fetch_all(pdm_url: &str, algorithm_id: &str) -> Result<Vec<Record>, String> {
    let mut records: Vec<Record> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut page = 0usize;
    loop {
        page += 1;
        let base = pdm_url.trim_end_matches('/');
        let url = match &cursor {
            Some(c) => format!("{base}/records?algorithmId={algorithm_id}&cursor={c}"),
            None => format!("{base}/records?algorithmId={algorithm_id}"),
        };
        let body = ureq::get(&url)
            .call()
            .map_err(|e| format!("GET {url} failed: {e}"))?
            .into_string()
            .map_err(|e| format!("read {url} failed: {e}"))?;
        let p: Page = serde_json::from_str(&body).map_err(|e| format!("parse {url} failed: {e}"))?;
        let batch_len = p.records.len();
        records.extend(p.records);
        eprintln!("page {page}: fetched {batch_len} records, cumulative {}", records.len());
        match p.next_cursor {
            Some(c) if !c.is_empty() => cursor = Some(c),
            _ => break,
        }
    }
    Ok(records)
}

fn main() {
    let pdm_url = std::env::var("PDM_URL").expect("PDM_URL is required");
    let algorithm_id = std::env::var("ALGORITHM_ID").expect("ALGORITHM_ID is required");

    let records = fetch_all(&pdm_url, &algorithm_id).expect("fetch records");
    eprintln!("received {} records", records.len());

    let out = serde_json::to_string(&analyze(&algorithm_id, &records)).expect("serialize");
    println!("{out}");
}