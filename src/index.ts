import type { PluginObj } from "@babel/core";
export default function plugin(babel: typeof import("@babel/core")): PluginObj {
  return {
    name: "react-unclass",
    visitor: {},
  };
}
