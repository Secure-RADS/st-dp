require "json"
require "net/http"
require "uri"

def log(msg)
  warn(msg)
end

def fetch_page(base, algorithm_id, cursor)
  params = { "algorithmId" => algorithm_id }
  params["cursor"] = cursor if cursor
  uri = URI.parse("#{base.sub(%r{/$}, "")}/records")
  uri.query = URI.encode_www_form(params)
  res = Net::HTTP.get_response(uri)
  raise "PDM returned HTTP #{res.code} for #{uri}" unless res.is_a?(Net::HTTPSuccess)
  JSON.parse(res.body)
end

def fetch_all(base, algorithm_id)
  records = []
  cursor = nil
  page = 0
  loop do
    page += 1
    body = fetch_page(base, algorithm_id, cursor)
    records.concat(body["records"])
    log("page #{page}: fetched #{body["records"].length} records, cumulative #{records.length}")
    cursor = body["nextCursor"]
    break if cursor.nil? || cursor.empty?
  end
  records
end

def analyze(algorithm_id, records)
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
    "algorithmId" => algorithm_id,
    "userCount" => records.length,
    "eligibleCount" => eligible_ids.length,
    "eligiblePct" => (100.0 * eligible_ids.length / records.length).round(2),
    "exclusionBreakdown" => exclusions,
    "eligibleRecordIds" => eligible_ids.first(50)
  }
end

base = ENV.fetch("PDM_URL")
algorithm_id = ENV.fetch("ALGORITHM_ID")
records = fetch_all(base, algorithm_id)
log("received #{records.length} records")
puts JSON.generate(analyze(algorithm_id, records))