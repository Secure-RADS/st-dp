import type { AwsService, CostOperation, CostUnit } from "@srads/common/cost";
import { PRICES, type PriceRule } from "./prices.js";

export function priceFor(service: AwsService, operation: CostOperation): PriceRule {
  return (PRICES[service] as Record<string, PriceRule>)[operation];
}

export function unitFor(service: AwsService, operation: CostOperation): CostUnit {
  return priceFor(service, operation).unit;
}

export function costUsd(rule: PriceRule, quantity: number): number {
  if (!(quantity > 0)) {
    return 0;
  }

  if (rule.bytesPerBillableUnit) {
    const chunks = Math.ceil(quantity / rule.bytesPerBillableUnit);
    return chunks * (rule.billableUnitsPerChunk ?? 1) * rule.usdPerBillableUnit;
  }

  return Math.max(quantity, rule.minBillableUnits ?? 0) * rule.usdPerBillableUnit;
}
