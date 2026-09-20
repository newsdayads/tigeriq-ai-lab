# Skill Effectiveness Tracking

This module provides lightweight, in-memory tracking for TigerIQ skill execution and effectiveness measurement.

## The Lifecycle Loop

1. **USE**: Record skill executions via `useSkill(id, input)`.
2. **MEASURE**: Calculate success rates via `measureEffectiveness(id)`.
3. **RETIRE**: Clear historical execution data via `retireSkill(id)`.

## Usage Example

javascript
import { useSkill, measureEffectiveness, retireSkill } from '../../../apps/tigeriq-core/skill-effectiveness.mjs';

// 1. Record usage
useSkill('data-parser', { success: true });
useSkill('data-parser', { success: false });

// 2. Measure effectiveness
const stats = measureEffectiveness('data-parser');
console.log(stats); // { id: 'data-parser', total: 2, successRate: 0.5 }

// 3. Retire skill data
retireSkill('data-parser');


## Safety Notes

- Data is stored strictly in an in-memory `Map` scoped to the module instance. No external persistence or disk writes occur.
- The module does not depend on Chrome-controller or worker-utility code, ensuring clean separation of concerns.
- Ensure skill IDs are unique strings to prevent unintended collision in the shared map.
