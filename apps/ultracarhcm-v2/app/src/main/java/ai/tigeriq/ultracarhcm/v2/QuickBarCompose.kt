package ai.tigeriq.ultracarhcm.v2

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Route
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

internal data class QuickSlotUi(
    val index: Int,
    val label: String,
    val icon: QuickSlotIcon,
)

internal fun quickSlotIconVector(icon: QuickSlotIcon): ImageVector = when (icon) {
    QuickSlotIcon.PLAY -> Icons.Filled.PlayArrow
    QuickSlotIcon.CAR -> Icons.Filled.DirectionsCar
    QuickSlotIcon.ROUTE -> Icons.Filled.Route
    QuickSlotIcon.CAMERA -> Icons.Filled.Videocam
    QuickSlotIcon.ADD -> Icons.Filled.Add
    QuickSlotIcon.APPS -> Icons.Filled.Apps
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun QuickBarGrid(
    slots: List<QuickSlotUi>,
    onClick: (Int) -> Unit,
    onLongClick: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    require(slots.size == QuickSlotRules.SLOT_COUNT) {
        "QuickBar requires exactly ${QuickSlotRules.SLOT_COUNT} slots"
    }

    Column(
        modifier = modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        repeat(3) { rowIndex ->
            Row(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                repeat(3) { columnIndex ->
                    val slot = slots[rowIndex * 3 + columnIndex]
                    val title = slot.label.ifBlank { "Ô ${slot.index + 1}" }
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .combinedClickable(
                                onClick = { onClick(slot.index) },
                                onLongClick = { onLongClick(slot.index) },
                            ),
                        shape = MaterialTheme.shapes.medium,
                        tonalElevation = 2.dp,
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(
                                imageVector = quickSlotIconVector(slot.icon),
                                contentDescription = title,
                            )
                            Text(
                                text = title,
                                style = MaterialTheme.typography.labelMedium,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}
