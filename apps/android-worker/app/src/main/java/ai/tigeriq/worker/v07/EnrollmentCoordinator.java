package ai.tigeriq.worker.v07;

import android.content.Context;

public final class EnrollmentCoordinator {
    private final EmployeeDeviceStore identities;
    private final SecureSecretStore secrets;
    private final WorkerStatusStore status;

    public EnrollmentCoordinator(Context context) {
        Context app = context.getApplicationContext();
        identities = new EmployeeDeviceStore(app);
        secrets = new SecureSecretStore(app);
        status = new WorkerStatusStore(app);
    }

    public EmployeeDeviceStore.Profile enroll(String gatewayUrl, String employeeId, String credentialId, String bootstrapToken) throws Exception {
        if (bootstrapToken == null || bootstrapToken.trim().isEmpty()) throw new IllegalArgumentException("TigerIQ bootstrap token is required");
        EmployeeDeviceStore.Profile draft = identities.draft(gatewayUrl, employeeId, credentialId);
        try {
            DeviceKeyStore deviceKey = new DeviceKeyStore(draft.employeeId, draft.deviceId);
            deviceKey.ensureKey();
            if (!deviceKey.isHardwareBacked()) throw new DeviceKeyStore.HardwareBackingUnavailableException();
            String fingerprint = deviceKey.publicKeyFingerprintSha256();
            secrets.put(SecureSecretStore.BOOTSTRAP_TOKEN, bootstrapToken.trim());
            TigerIqApiClient.Session session = new TigerIqApiClient(draft).mintSession(bootstrapToken.trim());
            secrets.put(SecureSecretStore.SESSION_TOKEN, session.accessToken);
            secrets.putLong(SecureSecretStore.SESSION_EXPIRES_AT, session.expiresAtEpochMs);
            EmployeeDeviceStore.Profile enrolled = new EmployeeDeviceStore.Profile(
                    draft.gatewayUrl, draft.employeeId, draft.nodeId, draft.deviceId, draft.credentialId,
                    fingerprint, true, System.currentTimeMillis());
            identities.saveEnrolled(enrolled, fingerprint, true, enrolled.enrolledAtEpochMs);
            status.setState(WorkerState.READY, "Đã đăng ký · khóa thiết bị hardware-backed", "");
            return identities.load();
        } catch (Exception error) {
            secrets.remove(SecureSecretStore.BOOTSTRAP_TOKEN);
            secrets.remove(SecureSecretStore.SESSION_TOKEN);
            secrets.remove(SecureSecretStore.SESSION_EXPIRES_AT);
            String detail = error instanceof DeviceKeyStore.HardwareBackingUnavailableException
                    ? "Thiết bị không xác nhận secure-hardware Keystore"
                    : "Đăng ký thiết bị thất bại: " + safeMessage(error);
            status.setState(WorkerState.NEED_ATTENTION, detail, "");
            throw error;
        }
    }

    private static String safeMessage(Exception error) {
        if (error instanceof ApiException api) return api.code;
        return error.getClass().getSimpleName();
    }
}
