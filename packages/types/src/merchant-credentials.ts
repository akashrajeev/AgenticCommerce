export type MerchantAgentCredential = {
  algorithm: "Ed25519";
  keyId: string;
  merchantId: string;
  agentId: string;
  issuer: string;
  publicKeyPem: string;
};

export type MerchantOfferAttestation = {
  offerId: string;
  credential: MerchantAgentCredential;
  signatureBase64: string;
};
