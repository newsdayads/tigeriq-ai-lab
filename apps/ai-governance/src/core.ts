export type SpendMode='free-only'|'budgeted'|'owner-approval';
export interface ProviderUsage {providerId:string;requests:number;inputTokens:number;outputTokens:number;estimatedCostUsd:number;windowStartedAt:string;}
export interface UsagePolicy {mode:SpendMode;maxEstimatedCostUsd:number;maxRequests:number;maxTokens:number;requireApprovalAboveUsd:number;}
export type UsageDecision='allow'|'authorization'|'blocked';
export interface UsageCheck {decision:UsageDecision;reason:string;projectedCostUsd:number;projectedRequests:number;projectedTokens:number;}
export interface RateWindow {providerId:string;limit:number;used:number;resetAt:string;}

function nonNegative(value:number,name:string):number{if(!Number.isFinite(value)||value<0)throw new Error(`INVALID_${name.toUpperCase()}`);return value;}

export function checkUsage(policy:UsagePolicy,current:ProviderUsage,estimate:{requests:number;inputTokens:number;outputTokens:number;estimatedCostUsd:number}):UsageCheck{
  const projectedCostUsd=nonNegative(current.estimatedCostUsd,'current_cost')+nonNegative(estimate.estimatedCostUsd,'estimated_cost');
  const projectedRequests=nonNegative(current.requests,'current_requests')+nonNegative(estimate.requests,'estimated_requests');
  const projectedTokens=nonNegative(current.inputTokens+current.outputTokens,'current_tokens')+nonNegative(estimate.inputTokens+estimate.outputTokens,'estimated_tokens');
  if(policy.maxEstimatedCostUsd<0||policy.maxRequests<1||policy.maxTokens<1||policy.requireApprovalAboveUsd<0)throw new Error('INVALID_USAGE_POLICY');
  if(projectedRequests>policy.maxRequests)return {decision:'blocked',reason:'request_budget_exceeded',projectedCostUsd,projectedRequests,projectedTokens};
  if(projectedTokens>policy.maxTokens)return {decision:'blocked',reason:'token_budget_exceeded',projectedCostUsd,projectedRequests,projectedTokens};
  if(projectedCostUsd>policy.maxEstimatedCostUsd)return {decision:'blocked',reason:'cost_budget_exceeded',projectedCostUsd,projectedRequests,projectedTokens};
  if(policy.mode==='free-only'&&projectedCostUsd>0)return {decision:'authorization',reason:'paid_provider_requires_owner',projectedCostUsd,projectedRequests,projectedTokens};
  if(policy.mode==='owner-approval'&&estimate.estimatedCostUsd>0)return {decision:'authorization',reason:'paid_request_requires_owner',projectedCostUsd,projectedRequests,projectedTokens};
  if(estimate.estimatedCostUsd>policy.requireApprovalAboveUsd)return {decision:'authorization',reason:'request_cost_threshold',projectedCostUsd,projectedRequests,projectedTokens};
  return {decision:'allow',reason:'within_policy',projectedCostUsd,projectedRequests,projectedTokens};
}

export function rateCapacity(window:RateWindow,nowMs:number):number{
  if(window.limit<1||window.used<0)throw new Error('INVALID_RATE_WINDOW');
  const reset=Date.parse(window.resetAt);
  if(Number.isNaN(reset))throw new Error('INVALID_RATE_RESET');
  if(nowMs>=reset)return window.limit;
  return Math.max(0,window.limit-window.used);
}

export function canDispatchRateLimited(window:RateWindow,nowMs:number,requested=1):boolean{
  if(requested<1||!Number.isInteger(requested))throw new Error('INVALID_REQUESTED_CAPACITY');
  return rateCapacity(window,nowMs)>=requested;
}
