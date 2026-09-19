use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;

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
struct Request {
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

fn analyze(req: Request) -> Output {
    let mut per_interest: HashMap<&str, (usize, f64)> = HashMap::new();
    let mut tiers: HashMap<String, usize> =
        [("low", 0), ("medium", 0), ("high", 0)].map(|(k, v)| (k.to_string(), v)).into();
    let mut connections_sum = 0usize;

    for rec in &req.records {
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

    let n = req.records.len();
    Output {
        algorithm_id: req.algorithm_id,
        user_count: n,
        segments,
        engagement_tiers: tiers,
        avg_connections: round2(connections_sum as f64 / n as f64),
    }
}

fn main() {
    eprintln!("audience-segments-rust starting");
    let socket_path =
        std::env::var("SCE_SOCKET_PATH").unwrap_or_else(|_| "/run/sce/dc.sock".into());
    let _ = std::fs::remove_file(&socket_path);

    let listener = UnixListener::bind(&socket_path).expect("bind");
    eprintln!("listening on {}", socket_path);

    let (stream, _) = listener.accept().expect("accept");
    eprintln!("sce-unit connected");

    let mut reader = BufReader::with_capacity(1 << 20, &stream);
    let mut line = String::new();
    reader.read_line(&mut line).expect("read");

    let req: Request = serde_json::from_str(&line).expect("parse");
    eprintln!("received {} records", req.records.len());

    let out = serde_json::to_string(&analyze(req)).expect("serialize");
    let mut writer = &stream;
    writer.write_all(out.as_bytes()).expect("write");
    writer.write_all(b"\n").expect("write");
    eprintln!("result sent");
}
