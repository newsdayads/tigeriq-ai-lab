import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { FileJournal } from '../../../event-store/src/index.js';
import type {
  AndroidPermission,
  DeviceIdentity,
  EmployeeDeviceBinding,
  EmployeeIdentity,
  EmployeeNamespaces,
  EmployeeState,
  EnrollmentGrant,
} from './types.js';

const IDENTITY_STREAM = 'workforce:v07:identity';
const ID_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{2,63}$/;

type IdentityEvent =
  | { action: 'employee-created'; employee: EmployeeIdentity }
  | { action: 'employee-state'; employeeId: string; state: EmployeeState; at: string }
  | { action: 'device-created'; device: DeviceIdentity }
  | { action: 'enrollment-requested'; binding: EmployeeDeviceBinding; tokenHash: string; expiresAt: string }
  | { action: 'enrollment-activated'; bindingId: string; activatedAt: string }
  | { action: 'device-lost'; deviceId: string; at: string }
  | { action: 'binding-revoked'; bindingId: string; at: string }
  | { action: 'device-revoked'; deviceId: string; at: string }
  | { action: 'binding-replaced'; bindingId: string; replacementBindingId: string; at: string }
  | { action: 'device-replaced'; deviceId: string; replacementDeviceId: string; at: string };

interface Projection {
  employees: Map<string, EmployeeIdentity>;
  devices: Map<string, DeviceIdentity>;
  bindings: Map<string, EmployeeDeviceBinding>;
  enrollmentSecrets: Map<string, { tokenHash: string; expiresAt: string }>;
}

export class AndroidV07Registry {
  constructor(
    private readonly journal: FileJournal,
    private readonly now: () => Date = () => new Date(),
    private readonly enrollmentTtlMs = 10 * 60_000,
    private readonly actor = 'workforce-android-v07',
  ) {
    if (enrollmentTtlMs < 30_000 || enrollmentTtlMs > 60 * 60_000) throw new Error('enrollment TTL must be between 30 seconds and 60 minutes');
  }

  static namespaces(employeeId: string): EmployeeNamespaces {
    assertId(employeeId, 'employeeId');
    const employee = `workforce:v07:employee:${employeeId}`;
    return { employee, queue: `${employee}:queue`, memory: `${employee}:memory`, evidence: `${employee}:evidence` };
  }

  async createEmployee(input: Omit<EmployeeIdentity, 'state' | 'createdAt'> & Partial<Pick<EmployeeIdentity, 'state' | 'createdAt'>>): Promise<EmployeeIdentity> {
    assertId(input.employeeId, 'employeeId');
    if (!input.displayName.trim()) throw new Error('displayName is required');
    if (input.roles.length === 0) throw new Error('at least one role is required');
    if (input.permissions.length === 0) throw new Error('at least one permission is required');
    const projection = await this.#projection();
    if (projection.employees.has(input.employeeId)) throw new Error(`employee ${input.employeeId} already exists`);
    const employee: EmployeeIdentity = {
      employeeId: input.employeeId,
      displayName: input.displayName,
      roles: unique(input.roles),
      permissions: unique(input.permissions),
      state: input.state ?? 'active',
      createdAt: input.createdAt ?? this.now().toISOString(),
    };
    await this.#append({ action: 'employee-created', employee });
    return structuredClone(employee);
  }

  async setEmployeeState(employeeId: string, state: EmployeeState): Promise<EmployeeIdentity> {
    const projection = await this.#projection();
    const employee = projection.employees.get(employeeId);
    if (!employee) throw new Error(`employee ${employeeId} not found`);
    await this.#append({ action: 'employee-state', employeeId, state, at: this.now().toISOString() });
    return { ...employee, roles: [...employee.roles], permissions: [...employee.permissions], state };
  }

  async requestEnrollment(input: { employeeId: string; deviceId: string; publicKeyFingerprint: string }): Promise<EnrollmentGrant> {
    assertId(input.employeeId, 'employeeId');
    assertId(input.deviceId, 'deviceId');
    if (!/^[a-f0-9]{64}$/i.test(input.publicKeyFingerprint)) throw new Error('publicKeyFingerprint must be SHA-256 hex');
    const projection = await this.#projection();
    const employee = projection.employees.get(input.employeeId);
    if (!employee || employee.state !== 'active') throw new Error('employee is not active');
    if (projection.devices.has(input.deviceId)) throw new Error(`device ${input.deviceId} already exists`);
    if ([...projection.bindings.values()].some((binding) => binding.employeeId === input.employeeId && binding.state === 'active')) {
      throw new Error('employee already has an active device binding');
    }

    const enrollmentId = `ENR-${randomUUID()}`.toUpperCase();
    const bindingId = `BND-${randomUUID()}`.toUpperCase();
    const activationToken = randomBytes(32).toString('base64url');
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + this.enrollmentTtlMs).toISOString();
    const device: DeviceIdentity = {
      deviceId: input.deviceId,
      platform: 'android',
      publicKeyFingerprint: input.publicKeyFingerprint.toLowerCase(),
      state: 'pending',
      createdAt,
    };
    const binding: EmployeeDeviceBinding = {
      bindingId,
      employeeId: input.employeeId,
      deviceId: input.deviceId,
      enrollmentId,
      state: 'pending',
      enrolledAt: createdAt,
    };
    await this.#append({ action: 'device-created', device });
    await this.#append({ action: 'enrollment-requested', binding, tokenHash: sha256(activationToken), expiresAt });
    return { enrollmentId, employeeId: input.employeeId, deviceId: input.deviceId, bindingId, activationToken, expiresAt };
  }

  async activateEnrollment(enrollmentId: string, activationToken: string): Promise<EmployeeDeviceBinding> {
    const projection = await this.#projection();
    const binding = [...projection.bindings.values()].find((item) => item.enrollmentId === enrollmentId);
    if (!binding || binding.state !== 'pending') throw new Error('enrollment is not pending');
    const secret = projection.enrollmentSecrets.get(enrollmentId);
    if (!secret) throw new Error('enrollment secret not found');
    if (this.now().getTime() > Date.parse(secret.expiresAt)) throw new Error('enrollment expired');
    if (!safeHashEqual(secret.tokenHash, sha256(activationToken))) throw new Error('invalid enrollment token');
    const employee = projection.employees.get(binding.employeeId);
    const device = projection.devices.get(binding.deviceId);
    if (!employee || employee.state !== 'active' || !device || device.state !== 'pending') throw new Error('enrollment subject is not active');
    const activatedAt = this.now().toISOString();
    await this.#append({ action: 'enrollment-activated', bindingId: binding.bindingId, activatedAt });
    return { ...binding, state: 'active', activatedAt };
  }

  async markDeviceLost(deviceId: string): Promise<void> {
    const projection = await this.#projection();
    const device = projection.devices.get(deviceId);
    if (!device) throw new Error(`device ${deviceId} not found`);
    if (device.state === 'lost' || device.state === 'revoked' || device.state === 'replaced') return;
    const at = this.now().toISOString();
    await this.#append({ action: 'device-lost', deviceId, at });
    for (const binding of projection.bindings.values()) {
      if (binding.deviceId === deviceId && binding.state === 'active') await this.#append({ action: 'binding-revoked', bindingId: binding.bindingId, at });
    }
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const projection = await this.#projection();
    const device = projection.devices.get(deviceId);
    if (!device) throw new Error(`device ${deviceId} not found`);
    const at = this.now().toISOString();
    if (device.state !== 'revoked') await this.#append({ action: 'device-revoked', deviceId, at });
    for (const binding of projection.bindings.values()) {
      if (binding.deviceId === deviceId && (binding.state === 'active' || binding.state === 'pending')) {
        await this.#append({ action: 'binding-revoked', bindingId: binding.bindingId, at });
      }
    }
  }

  async replaceDevice(input: { employeeId: string; oldDeviceId: string; newDeviceId: string; publicKeyFingerprint: string }): Promise<EnrollmentGrant> {
    const projection = await this.#projection();
    const oldBinding = [...projection.bindings.values()].find((binding) =>
      binding.employeeId === input.employeeId && binding.deviceId === input.oldDeviceId && (binding.state === 'active' || binding.state === 'revoked'));
    if (!oldBinding) throw new Error('old employee-device binding not found');
    if (input.oldDeviceId === input.newDeviceId) throw new Error('replacement must use a new deviceId');
    if (projection.devices.has(input.newDeviceId)) throw new Error('replacement deviceId already exists');
    if (oldBinding.state === 'active') await this.revokeDevice(input.oldDeviceId);
    const grant = await this.requestEnrollment({ employeeId: input.employeeId, deviceId: input.newDeviceId, publicKeyFingerprint: input.publicKeyFingerprint });
    const at = this.now().toISOString();
    await this.#append({ action: 'binding-replaced', bindingId: oldBinding.bindingId, replacementBindingId: grant.bindingId, at });
    await this.#append({ action: 'device-replaced', deviceId: input.oldDeviceId, replacementDeviceId: input.newDeviceId, at });
    return grant;
  }

  async employee(employeeId: string): Promise<EmployeeIdentity | undefined> {
    const employee = (await this.#projection()).employees.get(employeeId);
    return employee ? structuredClone(employee) : undefined;
  }

  async device(deviceId: string): Promise<DeviceIdentity | undefined> {
    const device = (await this.#projection()).devices.get(deviceId);
    return device ? structuredClone(device) : undefined;
  }

  async binding(employeeId: string, deviceId: string): Promise<EmployeeDeviceBinding | undefined> {
    const binding = [...(await this.#projection()).bindings.values()].find((item) => item.employeeId === employeeId && item.deviceId === deviceId && item.state === 'active');
    return binding ? structuredClone(binding) : undefined;
  }

  async authorize(employeeId: string, deviceId: string, permission: AndroidPermission): Promise<EmployeeDeviceBinding> {
    const projection = await this.#projection();
    const employee = projection.employees.get(employeeId);
    const device = projection.devices.get(deviceId);
    const binding = [...projection.bindings.values()].find((item) => item.employeeId === employeeId && item.deviceId === deviceId && item.state === 'active');
    if (!employee || employee.state !== 'active') throw new Error('employee is not active');
    if (!device || device.state !== 'active') throw new Error('device is not active');
    if (!binding) throw new Error('active employee-device binding not found');
    if (!employee.permissions.includes(permission)) throw new Error(`employee lacks permission ${permission}`);
    return structuredClone(binding);
  }

  async #append(event: IdentityEvent): Promise<void> {
    const events = await this.journal.readStream<IdentityEvent>(IDENTITY_STREAM);
    await this.journal.append(IDENTITY_STREAM, events.length, {
      type: `workforce.v07.${event.action}`,
      actor: this.actor,
      payload: event,
      timestamp: this.now().toISOString(),
    });
  }

  async #projection(): Promise<Projection> {
    const events = await this.journal.readStream<IdentityEvent>(IDENTITY_STREAM);
    const projection: Projection = { employees: new Map(), devices: new Map(), bindings: new Map(), enrollmentSecrets: new Map() };
    for (const entry of events) {
      const event = entry.payload;
      if (event.action === 'employee-created') projection.employees.set(event.employee.employeeId, structuredClone(event.employee));
      else if (event.action === 'employee-state') {
        const employee = projection.employees.get(event.employeeId); if (employee) employee.state = event.state;
      } else if (event.action === 'device-created') projection.devices.set(event.device.deviceId, structuredClone(event.device));
      else if (event.action === 'enrollment-requested') {
        projection.bindings.set(event.binding.bindingId, structuredClone(event.binding));
        projection.enrollmentSecrets.set(event.binding.enrollmentId, { tokenHash: event.tokenHash, expiresAt: event.expiresAt });
      } else if (event.action === 'enrollment-activated') {
        const binding = projection.bindings.get(event.bindingId);
        if (binding) {
          binding.state = 'active'; binding.activatedAt = event.activatedAt;
          const device = projection.devices.get(binding.deviceId); if (device) device.state = 'active';
        }
      } else if (event.action === 'device-lost') {
        const device = projection.devices.get(event.deviceId); if (device) { device.state = 'lost'; device.lostAt = event.at; }
      } else if (event.action === 'binding-revoked') {
        const binding = projection.bindings.get(event.bindingId); if (binding) { binding.state = 'revoked'; binding.revokedAt = event.at; }
      } else if (event.action === 'device-revoked') {
        const device = projection.devices.get(event.deviceId); if (device) { device.state = 'revoked'; device.revokedAt = event.at; }
      } else if (event.action === 'binding-replaced') {
        const binding = projection.bindings.get(event.bindingId); if (binding) { binding.state = 'replaced'; binding.replacedByBindingId = event.replacementBindingId; }
      } else if (event.action === 'device-replaced') {
        const device = projection.devices.get(event.deviceId); if (device) { device.state = 'replaced'; device.replacedByDeviceId = event.replacementDeviceId; }
      }
    }
    return projection;
  }
}

function unique<T extends string>(values: T[]): T[] { return [...new Set(values)]; }
function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function safeHashEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex'); const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
function assertId(value: string, name: string): void { if (!ID_PATTERN.test(value)) throw new Error(`${name} must match ${ID_PATTERN}`); }
