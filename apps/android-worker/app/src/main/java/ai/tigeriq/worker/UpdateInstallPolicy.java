package ai.tigeriq.worker;

/** Pure update-channel policy. Keeps managed fleet updates away from PackageInstaller. */
final class UpdateInstallPolicy {
    enum Action {
        SELF_INSTALL,
        MANAGED_PENDING,
        REJECT
    }

    private UpdateInstallPolicy() {}

    static Action actionFor(String rawMode) {
        String mode = rawMode == null ? "" : rawMode.trim().toUpperCase(java.util.Locale.ROOT);
        if (mode.isEmpty() || "SELF_INSTALL".equals(mode)) return Action.SELF_INSTALL;
        if ("MANAGED_PLAY".equals(mode) || "MANAGED_MDM".equals(mode)) return Action.MANAGED_PENDING;
        return Action.REJECT;
    }
}
