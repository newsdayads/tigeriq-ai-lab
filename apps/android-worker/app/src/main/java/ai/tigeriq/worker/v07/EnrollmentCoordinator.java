package ai.tigeriq.worker.v07;

import android.content.Context;

/** Creates the phone-owned Keystore identity and verifies Controller V1 health; PC01 binding is provisioned separately. */
public final class EnrollmentCoordinator {
    private static final String CONTROLLER_V1_CREDENTIAL_MARKER = "CONTROLLER-V1";

    private final Context app;

    public EnrollmentCoordinator(Context context) { this.app = context.getApplicationContext(); }

    public EmployeeDeviceStore.Profile enroll(String controllerUrl, String employeeId) throws Exception {
        EmployeeDeviceStore identities = new EmployeeDeviceStore(app);
        EmployeeDeviceStore.Profile draft = identities.draft(controllerUrl, employeeId, CONTROLLER_V1_CREDENTIAL_MARKER);
        DeviceKeyStore keyStore = new DeviceKeyStore(draft.employeeId, draft.deviceId);
        keyStore.ensureKey();
        if (!keyStore.isHardwareBacked()) throw new DeviceKeyStore.HardwareBackingUnavailableException();
        String fingerprint = keyStore.publicKeyFingerprintSha256();

        // Status is deliberately the only unauthenticated compatibility probe in Controller V1.
        new TigerIqApiClient(draft).requireControllerV1Ready();

        EmployeeDeviceStore.Profile local = new EmployeeDeviceStore.Profile(
                draft.controllerUrl, draft.employeeId, draft.nodeId, draft.deviceId,
                CONTROLLER_V1_CREDENTIAL_MARKER, "", fingerprint, true, System.currentTimeMillis());
        identities.saveEnrolled(local, fingerprint, true, local.enrolledAtEpochMs);
        new WorkerStatusStore(app).setState(WorkerState.NEED_ATTENTION,
                "Danh tính Controller V1 đã sẵn sàng · chờ PC01 provision/binding", null);
        return identities.load();
    }
}
