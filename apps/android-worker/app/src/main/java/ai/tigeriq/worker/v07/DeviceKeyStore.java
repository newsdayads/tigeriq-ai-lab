package ai.tigeriq.worker.v07;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

public final class DeviceKeyStore {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private final String alias;

    public DeviceKeyStore(String employeeId, String deviceId) {
        this.alias = aliasFor(employeeId, deviceId);
    }

    static String aliasFor(String employeeId, String deviceId) {
        String employee = IdentityRules.requireId("employeeId", employeeId);
        String device = IdentityRules.requireId("deviceId", deviceId);
        String framed = employee.length() + ":" + employee + "|" + device.length() + ":" + device;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(framed.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) hex.append(String.format("%02x", value));
            return "tigeriq.v07." + hex;
        } catch (Exception error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    public synchronized void ensureKey() throws Exception {
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        if (store.containsAlias(alias)) {
            requireHardwareBacking(store);
            return;
        }

        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                generator.initialize(baseBuilder().setIsStrongBoxBacked(true).build());
                generator.generateKeyPair();
                store.load(null);
                requireHardwareBacking(store);
                return;
            } catch (Exception ignored) {
                store.load(null);
                if (store.containsAlias(alias)) store.deleteEntry(alias);
            }
        }

        generator.initialize(baseBuilder().build());
        generator.generateKeyPair();
        store.load(null);
        try {
            requireHardwareBacking(store);
        } catch (Exception error) {
            if (store.containsAlias(alias)) store.deleteEntry(alias);
            throw error;
        }
    }

    public synchronized String signChallenge(byte[] challenge) throws Exception {
        if (challenge == null || challenge.length == 0) throw new IllegalArgumentException("challenge required");
        ensureKey();
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        PrivateKey key = (PrivateKey) store.getKey(alias, null);
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(key);
        signature.update(challenge);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign());
    }

    public synchronized String signCanonical(String canonical) throws Exception {
        if (canonical == null || canonical.isBlank()) throw new IllegalArgumentException("canonical request required");
        return signChallenge(canonical.getBytes(StandardCharsets.UTF_8));
    }

    public synchronized String publicKeyBase64() throws Exception {
        ensureKey();
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        return Base64.getEncoder().encodeToString(store.getCertificate(alias).getPublicKey().getEncoded());
    }

    public synchronized String publicKeyFingerprintSha256() throws Exception {
        ensureKey();
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        byte[] encoded = store.getCertificate(alias).getPublicKey().getEncoded();
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(encoded);
        StringBuilder out = new StringBuilder(digest.length * 2);
        for (byte b : digest) out.append(String.format("%02x", b));
        return out.toString();
    }

    public synchronized boolean isHardwareBacked() throws Exception {
        ensureKey();
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        return hardwareBacked(store);
    }

    private void requireHardwareBacking(KeyStore store) throws Exception {
        if (!hardwareBacked(store)) throw new HardwareBackingUnavailableException();
    }

    private boolean hardwareBacked(KeyStore store) throws Exception {
        PrivateKey key = (PrivateKey) store.getKey(alias, null);
        if (key == null) return false;
        KeyFactory factory = KeyFactory.getInstance(key.getAlgorithm(), ANDROID_KEYSTORE);
        KeyInfo info = factory.getKeySpec(key, KeyInfo.class);
        return info.isInsideSecureHardware();
    }

    private KeyGenParameterSpec.Builder baseBuilder() {
        return new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false);
    }

    public static final class HardwareBackingUnavailableException extends Exception {
        public HardwareBackingUnavailableException() { super("AndroidKeyStore secure hardware unavailable"); }
    }
}
