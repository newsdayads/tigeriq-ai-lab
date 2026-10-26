package com.tigeriq.ultracar.ui

import android.content.Context
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Source-only candidate for the existing UltraCar HOME Compose card.
 * The call site MUST live inside the original Home card's Column, between
 * its START control and its existing 3 native bottom actions.
 * Do NOT add this as an Activity overlay, Popup, Dialog or another window.
 */
data class QuickLayoutSlot(
    val index: Int,                       // 0..4
    val sessionId: String?,               // stable saved-layout session ID
    val title: String,
    val icon: ImageBitmap?
)

/**
 * Renders as an ordinary Compose child: no background, box overlay,
 * backdrop, or absolute screen positioning. All five slots get equal width.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun QuickLayoutInlineRow(
    slots: List<QuickLayoutSlot>,
    onLaunch: (sessionId: String) -> Unit,
    onReassign: (slotIndex: Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val byIndex = slots.filter { it.index in 0..4 }.associateBy { it.index }
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(5) { index ->
            val slot = byIndex[index]
            val sessionId = slot?.sessionId?.takeIf { it.isNotBlank() }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .height(52.dp)
                    .combinedClickable(
                        onClick = {
                            if (sessionId != null) onLaunch(sessionId)
                            else onReassign(index)
                        },
                        onLongClick = { onReassign(index) }
                    ),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                val icon = slot?.icon
                if (icon != null) {
                    Image(
                        bitmap = icon,
                        contentDescription = slot.title,
                        modifier = Modifier.size(25.dp)
                    )
                } else {
                    Text(text = "+%02d".format(index + 1), fontSize = 14.sp)
                }
                Text(
                    text = slot?.title.orEmpty(),
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

/**
 * Integration contract: keep the original START and original 3-action
 * composables unchanged; insert shortcuts IN THE SAME HOME COLUMN.
 */
@Composable
fun UltraCarHomeControlColumn(
    startControl: @Composable () -> Unit,
    bottomActions: @Composable () -> Unit,
    slots: List<QuickLayoutSlot>,
    onLaunch: (String) -> Unit,
    onReassign: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        startControl()
        Spacer(Modifier.height(8.dp))
        QuickLayoutInlineRow(slots, onLaunch, onReassign)
        Spacer(Modifier.height(8.dp))
        bottomActions()
    }
}

/**
 * Reuses v56/v57 SharedPreferences keys; never clears saved layouts or
 * reassigns slots on every recomposition. Actual UI state propagation to
 * Compose must be wired by the host integration.
 */
class QuickLayoutSlotStore(context: Context) {
    private val prefs = context.getSharedPreferences(
        "tigeriq_v44_quick_slots", Context.MODE_PRIVATE
    )

    fun readIds(): List<String?> = (0..4).map { index ->
        prefs.getString("slot_" + index, null)?.takeIf { it.isNotBlank() }
    }

    fun assign(index: Int, sessionId: String) {
        require(index in 0..4) { "SLOT_INDEX_OUT_OF_RANGE" }
        require(sessionId.isNotBlank()) { "EMPTY_SESSION_ID" }
        prefs.edit().putString("slot_" + index, sessionId).apply()
    }
}
