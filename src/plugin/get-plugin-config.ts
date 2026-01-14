import type {Payload} from "payload";
import type {WorkflowsPluginConfig} from "./config-types.js";

/**
 * Retrieves the plugin configuration from payload.
 *
 * @param {Payload} payload - The payload instance.
 * @return {WorkflowsPluginConfig} The plugin configuration specific to '@xtr-dev/payload-automation'.
 * @throws {Error} If the plugin configuration is not found.
 */
export function getPluginConfig(payload: Payload) {
    if (!payload.config.custom?.pluginConfigs) {
        throw new Error('Plugin config not found')
    }
    return payload.config.custom.pluginConfigs['@xtr-dev/payload-automation'] as WorkflowsPluginConfig
}