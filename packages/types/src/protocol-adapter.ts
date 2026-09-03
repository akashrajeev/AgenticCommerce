import type {
  CommerceIntent,
  CommerceProtocol,
  MerchantOffer,
  ProtocolEnvelope,
} from "./protocol.js";

/**
 * Future ACP/AP2/UAP/x402 adapters terminate here before entering the
 * deterministic MANDATE core. The adapter owns wire-format details; the core
 * consumes normalized commerce semantics.
 */
export interface CommerceProtocolAdapter<TInput = unknown> {
  readonly protocol: CommerceProtocol;
  readonly version: string;

  normalizeIntent(input: ProtocolEnvelope<TInput>): CommerceIntent;
  normalizeOffer(input: ProtocolEnvelope<TInput>): MerchantOffer;
}
