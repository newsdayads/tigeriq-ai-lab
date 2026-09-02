package ai.tigeriq.worker.v07;

import org.junit.Test;

import static org.junit.Assert.*;

public final class ZeroCostPolicyTest {
    private static final class CountingConnector implements AiProviderConnector {
        int executeCalls;

        @Override public String providerId() { return ProviderConfigStore.GEMINI; }

        @Override public ProviderExecution execute(String prompt, String model) {
            executeCalls++;
            return new ProviderExecution(ProviderConfigStore.GEMINI, model, "ok", "start", "finish");
        }
    }

    @Test public void paidBillingCannotExecuteProvider() throws Exception {
        CountingConnector connector = new CountingConnector();
        try {
            ZeroCostPolicy.executeIfAllowed(ZeroCostPolicy.PAID, connector, "hello", "gemini-2.5-flash");
            fail("paid billing must fail closed");
        } catch (ProviderException error) {
            assertEquals("ZERO_COST_PAID_BLOCKED", error.code);
            assertFalse(error.retryable);
        }
        assertEquals(0, connector.executeCalls);
    }

    @Test public void unknownBillingCannotExecuteProvider() throws Exception {
        CountingConnector connector = new CountingConnector();
        try {
            ZeroCostPolicy.executeIfAllowed(ZeroCostPolicy.UNKNOWN, connector, "hello", "gemini-2.5-flash");
            fail("unknown billing must fail closed");
        } catch (ProviderException error) {
            assertEquals("ZERO_COST_BILLING_UNKNOWN", error.code);
            assertFalse(error.retryable);
        }
        assertEquals(0, connector.executeCalls);
    }

    @Test public void missingOrMalformedBillingIsUnknownAndCannotExecute() throws Exception {
        for (String state : new String[]{null, "", "maybe", "trial?"}) {
            CountingConnector connector = new CountingConnector();
            try {
                ZeroCostPolicy.executeIfAllowed(state, connector, "hello", "gemini-2.5-flash");
                fail("missing/malformed billing must fail closed");
            } catch (ProviderException error) {
                assertEquals("ZERO_COST_BILLING_UNKNOWN", error.code);
            }
            assertEquals(0, connector.executeCalls);
        }
    }

    @Test public void explicitlyConfirmedFreeExecutesExactlyOnce() throws Exception {
        CountingConnector connector = new CountingConnector();
        ProviderExecution execution = ZeroCostPolicy.executeIfAllowed(
                ZeroCostPolicy.FREE_CONFIRMED, connector, "hello", "gemini-2.5-flash");
        assertEquals(1, connector.executeCalls);
        assertEquals("ok", execution.text);
    }
}
