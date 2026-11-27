package ai.tigeriq.ultracarhcm.v2

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

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

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val sizing = QuickBarSizing.forHeight(maxHeight.value, LocalDensity.current.fontScale)
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(sizing.rowGapDp.dp),
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
                            // V1 cockpit lives on a dark road scene: do not let
                            // Material3's default bright Surface erase the dashboard.
                            color = Color(0xD00C2230),
                            contentColor = Color(0xFFF0FAFF),
                            border = BorderStroke(1.dp, Color(0x6657C9EC)),
                            tonalElevation = 0.dp,
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(horizontal = 6.dp, vertical = sizing.verticalPaddingDp.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Icon(
                                    imageVector = quickSlotIconVector(slot.icon),
                                    contentDescription = title,
                                    modifier = Modifier.size(sizing.iconDp.dp),
                                    tint = Color(0xFF67D7F6),
                                )
                                Text(
                                    text = title,
                                    style = MaterialTheme.typography.labelMedium.copy(
                                        platformStyle = PlatformTextStyle(includeFontPadding = false),
                                    ),
                                    color = Color(0xFFF0FAFF),
                                    fontSize = sizing.fontSp.sp,
                                    lineHeight = (sizing.fontSp * 1.2f).sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
