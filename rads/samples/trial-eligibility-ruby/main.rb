require "json"

def log(msg)
  warn(msg)
end

def load_records(path)
  body = JSON.parse(File.read(path))
  records = body.is_a?(Hash) ? body["records"] : body
  algorithm_id = body.is_a?(Hash) ? body["algorithmId"] : nil
  [algorithm_id, records]
end

def write_result(result)
  payload = JSON.generate(result)
  path = ENV["RESULT_PATH"]
  if path
    File.write(path, payload)
  else
    puts payload
  end
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

records_path = ENV.fetch("RECORDS_PATH")
algorithm_id, records = load_records(records_path)
log("loaded #{records.length} records from #{records_path}")
write_result(analyze(algorithm_id, records))
