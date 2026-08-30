package ai.tigeriq.worker;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

public final class WorkerIdentity {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "tigeriq-worker-device-p256";

    private WorkerIdentity() {}

    public static synchronized void ensureDeviceKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            if (keyStore.containsAlias(ALIAS)) return;

            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE);
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false)
                .build();
            generator.initialize(spec);
            generator.generateKeyPair();
        } catch (Exception error) {
            throw new IllegalStateException("Unable to initialize TigerIQ device identity", error);
        }
    }

    public static String publicKeyBase64() {
        try {
            ensureDeviceKey();
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            PublicKey publicKey = keyStore.getCertificate(ALIAS).getPublicKey();
            return Base64.getEncoder().encodeToString(publicKey.getEncoded());
        } catch (Exception error) {
            throw new IllegalStateException("Unable to read TigerIQ device public key", error);
        }
    }
}
