/** Services endpoint binding and request-identity settings. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

/**
 * IPv4 address of the Docker default bridge (`docker0`), which
 * `host.docker.internal:host-gateway` resolves to inside containers on Linux.
 * `os.networkInterfaces()` omits docker0 while no container sits on the
 * default bridge (NO-CARRIER), so fall back to `ip -j -4 addr show docker0`.
 */
export function dockerBridgeAddresses(
  interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
  readIp: () => string | null = defaultReadIp,
): string[] {
  const listed = (interfaces.docker0 ?? [])
    .filter((address) => address.family === "IPv4")
    .map((address) => address.address);
  if (listed.length) return listed;
  const text = readIp();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as Array<{ addr_info?: Array<{ family?: string; local?: string }> }>;
    return parsed
      .flatMap((entry) => entry.addr_info ?? [])
      .filter((info) => info.family === "inet" && typeof info.local === "string")
      .map((info) => info.local!);
  } catch {
    return [];
  }
}

function defaultReadIp(): string | null {
  if (process.platform !== "linux" || !existsSync("/sys/class/net/docker0")) return null;
  try {
    return execFileSync("ip", ["-j", "-4", "addr", "show", "dev", "docker0"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
  } catch {
    return null;
  }
}

/**
 * Hosts to listen on for a `SERVICES_HOST` value. `auto` (default) is
 * loopback plus the Docker default-bridge gateway, so the compose Restate can
 * reach the endpoint through host.docker.internal while the machine's public
 * interfaces stay closed. Anything else is an explicit comma list.
 */
export function resolveServicesHosts(
  value: string | undefined,
  interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
  readIp: () => string | null = defaultReadIp,
): string[] {
  const configured = (value ?? "").trim() || "auto";
  if (configured !== "auto") {
    return [...new Set(configured.split(",").map((host) => host.trim()).filter(Boolean))];
  }
  return [...new Set(["127.0.0.1", ...dockerBridgeAddresses(interfaces, readIp)])];
}

/** `RESTATE_IDENTITY_KEYS`: comma-separated `publickeyv1_…` request identity keys. */
export function resolveIdentityKeys(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}
