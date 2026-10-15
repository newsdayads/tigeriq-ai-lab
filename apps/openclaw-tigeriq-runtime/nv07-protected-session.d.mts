export interface Nv07NativeSessionProof {
  attestationVerified: boolean;
  deviceIdentityVerified: boolean;
  code: string;
  host?: 'PC01';
  windowsUser?: 'wdragons12x';
  pid?: number;
  sessionId?: number;
  sourceSha?: string;
  brokerHash?: string;
  at?: string;
  coreLeaseVerified?: false;
  nv07Active?: false;
}
export function attestNv07ProtectedSession(): Promise<Nv07NativeSessionProof>;
