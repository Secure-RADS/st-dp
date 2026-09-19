require "json"
require "socket"

SOCKET_PATH = ENV.fetch("SCE_SOCKET_PATH", "/run/sce/dc.sock")

def log(msg)
  warn(msg)
end

def analyze(request)
  records = request["records"]
  eligible_ids = []
  exclusions = { "age" => 0, "hba1c" => 0, "egfr" => 0, "ckd" => 0, "bmi" => 0 }

  records.each do |record|
    data = record["data"]
    labs = data["labs"]
    failed = []
    failed << "age" unless data["age"].between?(40, 75)
    failed << "hba1c" unless labs["hba1c"].between?(7.0, 10.0)
    failed << "egfr" unless labs["egfr"] >= 45
    failed << "ckd" if data["conditions"].include?("ckd")
    failed << "bmi" unless labs["bmi"].between?(25, 40)

    if failed.empty?
      eligible_ids << record["recordId"]
    else
      failed.each { |criterion| exclusions[criterion] += 1 }
    end
  end

  {
    "algorithmId" => request["algorithmId"],
    "userCount" => records.length,
    "eligibleCount" => eligible_ids.length,
    "eligiblePct" => (100.0 * eligible_ids.length / records.length).round(2),
    "exclusionBreakdown" => exclusions,
    "eligibleRecordIds" => eligible_ids.first(50)
  }
end

log("trial-eligibility-ruby starting")
File.delete(SOCKET_PATH) if File.exist?(SOCKET_PATH)

server = UNIXServer.new(SOCKET_PATH)
log("listening on #{SOCKET_PATH}")

conn = server.accept
log("sce-unit connected")

request = JSON.parse(conn.gets)
log("received #{request["records"].length} records")

conn.write(JSON.generate(analyze(request)) + "\n")
conn.close
log("result sent")
