package ai.tigeriq.ultracarhcm.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ObdProtocolTest {
    @Test fun parsesVehicleSpeedPid() {
        assertEquals(40, ObdProtocol.parseSpeedKph("41 0D 28\r>"))
        assertEquals(0, ObdProtocol.parseSpeedKph("SEARCHING...\r41 0D 00\r>"))
        assertNull(ObdProtocol.parseSpeedKph("NO DATA"))
    }

    @Test fun parsesEngineRpmPid() {
        assertEquals(1726, ObdProtocol.parseRpm("41 0C 1A F8\r>"))
        assertNull(ObdProtocol.parseRpm("41 0C 1A"))
        assertNull(ObdProtocol.parseRpm("ERROR"))
    }

    @Test fun parsesAdapterVoltage() {
        assertEquals(12.6, ObdProtocol.parseVoltage("12.6V\r>")!!, 0.001)
        assertEquals(14.18, ObdProtocol.parseVoltage("ATRV\r14.18 V\r>")!!, 0.001)
        assertNull(ObdProtocol.parseVoltage("NO DATA"))
    }
}
