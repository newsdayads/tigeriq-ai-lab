package ai.tigeriq.worker;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public final class UpdateInstallPolicyTest {
    @Test
    public void missingModePreservesLegacySelfInstall() {
        assertEquals(UpdateInstallPolicy.Action.SELF_INSTALL, UpdateInstallPolicy.actionFor(null));
        assertEquals(UpdateInstallPolicy.Action.SELF_INSTALL, UpdateInstallPolicy.actionFor(""));
        assertEquals(UpdateInstallPolicy.Action.SELF_INSTALL, UpdateInstallPolicy.actionFor("SELF_INSTALL"));
    }

    @Test
    public void managedChannelsNeverSelectSelfInstall() {
        assertEquals(UpdateInstallPolicy.Action.MANAGED_PENDING, UpdateInstallPolicy.actionFor("MANAGED_PLAY"));
        assertEquals(UpdateInstallPolicy.Action.MANAGED_PENDING, UpdateInstallPolicy.actionFor("managed_mdm"));
    }

    @Test
    public void unknownModeFailsClosed() {
        assertEquals(UpdateInstallPolicy.Action.REJECT, UpdateInstallPolicy.actionFor("SIDELOAD_BYPASS"));
        assertEquals(UpdateInstallPolicy.Action.REJECT, UpdateInstallPolicy.actionFor("UNKNOWN"));
    }
}
