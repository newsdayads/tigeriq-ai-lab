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

    @Test public void currentAuthorityIsUnverifiedAndNonExecutable() {
        ZeroCostAuthority authority = ZeroCostAuthority.current();
        assertEquals(ZeroCostAuthority.UNVERIFIED, authority.state());
        assertEquals(ZeroCostAuthority.REASON_NO_ENFORCEABLE_PROOF, authority.reason());
        assertFalse(authority.executionAllowed());
    }

    @Test public void legacyLocalFreeConfirmedClaimCannotElevateCredential() throws Exception {
        CountingConnector connector = new CountingConnector();
        ZeroCostAuthority authority = ZeroCostAuthority.fromLocalClaim("free_confirmed");
        try {
            ZeroCostPolicy.executeIfAuthorized(authority, connector, "hello", "gemini-2.5-flash");
            fail("local free_confirmed claim must never authorize provider execution");
        } catch (ProviderException error) {
            assertEquals("ZERO_COST_AUTHORITY_UNVERIFIED", error.code);
            assertFalse(error.retryable);
        }
        assertEquals(0, connector.executeCalls);
    }

    @Test public void anyLocalBillingStringRemainsUnverifiedAndCannotExecute() throws Exception {
        for (String claim : new String[]{null, "", "paid", "unknown", "free", "trial", "0-cost", "free_confirmed"}) {
            CountingConnector connector = new CountingConnector();
            ZeroCostAuthority authority = ZeroCostAuthority.fromLocalClaim(claim);
            assertFalse(authority.executionAllowed());
            try {
                ZeroCostPolicy.executeIfAuthorized(authority, connector, "hello", "gemini-2.5-flash");
                fail("local state cannot become billing authority");
            } catch (ProviderException error) {
                assertEquals("ZERO_COST_AUTHORITY_UNVERIFIED", error.code);
                assertFalse(error.retryable);
            }
            assertEquals(0, connector.executeCalls);
        }
    }

    @Test public void missingAuthorityFailsClosedWithoutConnectorCall() throws Exception {
        CountingConnector connector = new CountingConnector();
        try {
            ZeroCostPolicy.executeIfAuthorized(null, connector, "hello", "gemini-2.5-flash");
            fail("missing independent authority must fail closed");
        } catch (ProviderException error) {
            assertEquals("ZERO_COST_AUTHORITY_UNVERIFIED", error.code);
            assertFalse(error.retryable);
        }
        assertEquals(0, connector.executeCalls);
    }
}
