package ai.tigeriq.worker.v07;

import android.content.Context;

public final class EnrollmentCoordinator {
    private final EmployeeDeviceStore identities; private final SecureSecretStore secrets; private final WorkerStatusStore status;
    public EnrollmentCoordinator(Context context) { Context app = context.getApplicationContext(); identities = new EmployeeDeviceStore(app); secrets = new SecureSecretStore(app); status = new WorkerStatusStore(app); }
    public EmployeeDeviceStore.Profile enroll(String gatewayUrl, String employeeId, String credentialId, String bootstrapToken) throws Exception {
        if (bootstrapToken == null || bootstrapToken.trim().isEmpty()) throw new IllegalArgumentException("TigerIQ bootstrap token is required"); EmployeeDeviceStore.Profile draft = identities.draft(gatewayUrl, employeeId, credentialId); DeviceKeyStore deviceKey = new DeviceKeyStore(draft.employeeId, draft.deviceId); deviceKey.ensureKey(); String fingerprint = deviceKey.publicKeyFingerprintSha256(); boolean hardwareBacked = deviceKey.isHardwareBacked(); secrets.put(SecureSecretStore.BOOTSTRAP_TOKEN, bootstrapToken.trim());
        try { TigerIqApiClient.Session session = new TigerIqApiClient(draft).mintSession(bootstrapToken.trim()); secrets.put(SecureSecretStore.SESSION_TOKEN, session.accessToken); secrets.putLong(SecureSecretStore.SESSION_EXPIRES_AT, session.expiresAtEpochMs); EmployeeDeviceStore.Profile enrolled = new EmployeeDeviceStore.Profile(draft.gatewayUrl, draft.employeeId, draft.nodeId, draft.deviceId, draft.credentialId, fingerprint, hardwareBacked, System.currentTimeMillis()); identities.saveEnrolled(enrolled, fingerprint, hardwareBacked, enrolled.enrolledAtEpochMs); status.setState(WorkerState.READY, hardwareBacked ? "Đã đăng ký · khóa thiết bị hardware-backed" : "Đã đăng ký · AndroidKeyStore không xác nhận hardware-backed", ""); return identities.load(); }
        catch (Exception error) { secrets.remove(SecureSecretStore.BOOTSTRAP_TOKEN); secrets.remove(SecureSecretStore.SESSION_TOKEN); secrets.remove(SecureSecretStore.SESSION_EXPIRES_AT); status.setState(WorkerState.NEED_ATTENTION, "Đăng ký thiết bị thất bại: " + safeMessage(error), ""); throw error; }
    }
    private static String safeMessage(Exception error) { if (error instanceof ApiException api) return api.code; return error.getClass().getSimpleName(); }
}
