package ai.tigeriq.worker.v07;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;

import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

public final class DeviceKeyStore {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private final String alias;

    public DeviceKeyStore(String employeeId, String deviceId) {
        this.alias = "tigeriq.v07." + safe(employeeId) + "." + safe(deviceId);
    }

    public synchronized void ensureKey() throws Exception {
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        if (store.containsAlias(alias)) return;

        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false)
                .setIsStrongBoxBacked(true)
                .build();
        try {
            generator.initialize(spec);
            generator.generateKeyPair();
        } catch (Exception strongBoxUnavailable) {
            KeyGenParameterSpec fallback = new KeyGenParameterSpec.Builder(
                    alias,
                    KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(false)
                    .build();
            generator.initialize(fallback);
            generator.generateKeyPair();
        }
    }

    public synchronized String signChallenge(byte[] challenge) throws Exception {
        ensureKey();
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        PrivateKey key = (PrivateKey) store.getKey(alias, null);
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(key);
        signature.update(challenge);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign());
    }

    public synchronized String publicKeyBase64() throws Exception {
        ensureKey();
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        return Base64.getEncoder().encodeToString(store.getCertificate(alias).getPublicKey().getEncoded());
    }

    public synchronized boolean isHardwareBacked() throws Exception {
        ensureKey();
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        PrivateKey key = (PrivateKey) store.getKey(alias, null);
        KeyFactory factory = KeyFactory.getInstance(key.getAlgorithm(), ANDROID_KEYSTORE);
        KeyInfo info = factory.getKeySpec(key, KeyInfo.class);
        return info.isInsideSecureHardware();
    }

    private static String safe(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("identity required");
        return value.replaceAll("[^A-Za-z0-9._-]", "_");
    }
}
