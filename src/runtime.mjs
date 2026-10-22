import { spawn } from "node:child_process";

export function selectRuntime(
  platform = process.platform,
  args = process.argv.slice(2),
  env = process.env,
) {
  const mode =
    args.find((a) => a.startsWith("--runtime="))?.split("=")[1] ||
    env.GOA2_LAB_RUNTIME ||
    (platform === "win32" ? "wsl" : "native");
  if (!["native", "wsl"].includes(mode))
    throw new Error("Runtime must be native or wsl.");
  if (platform === "win32" && mode === "native")
    throw new Error(
      "On Windows use --runtime=wsl. Native services require Linux or macOS.",
    );
  return mode;
}

export function openURL(url, platform = process.platform) {
  const [command, args] =
    platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, {
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => console.log(`Open the comparison desk at ${url}`));
  child.unref();
}
