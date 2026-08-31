package ai.tigeriq.worker.v07;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class TigerIqMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(@NonNull String token) {
        try {
            new SecureSecretStore(this).put(SecureSecretStore.FCM_TOKEN, token);
            new WorkerStatusStore(this).setPushState("TOKEN_READY");
        } catch (Exception error) {
            new WorkerStatusStore(this).setPushState("TOKEN_STORE_FAILED");
        }
    }

    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        String type = message.getData().get("type");
        if (type == null || type.isBlank() || "job_available".equals(type) || "wake".equals(type)) {
            new WorkerStatusStore(this).setPushState("WAKE_RECEIVED");
            V07WorkScheduler.enqueueRecovery(this);
        }
    }
}
