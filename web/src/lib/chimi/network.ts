import deployment from "../../../public/deployments.json";
import { networkOf, type Network } from "@/lib/chimi/network-rules";

export type { Network } from "@/lib/chimi/network-rules";

/** The network this build runs on: the one deployments.json was deployed to (lib/chimi/network-rules.ts). */
export const NETWORK: Network = networkOf(deployment.chainId);
