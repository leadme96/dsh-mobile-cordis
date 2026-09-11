import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "dsh-mobile";
export interface Config {
    enabled: boolean;
    port: number;
    upstreamPort: number;
    lanIpOverride: string;
    pinEnabled: boolean;
    customPin: string;
    heartbeatInterval: number;
    dshHome: string;
}
export declare const Config: Schema<Schemastery.ObjectS<{
    enabled: Schema<boolean, boolean>;
    port: Schema<number, number>;
    upstreamPort: Schema<number, number>;
    lanIpOverride: Schema<string, string>;
    pinEnabled: Schema<boolean, boolean>;
    customPin: Schema<string, string>;
    heartbeatInterval: Schema<number, number>;
    dshHome: Schema<string, string>;
}>, Schemastery.ObjectT<{
    enabled: Schema<boolean, boolean>;
    port: Schema<number, number>;
    upstreamPort: Schema<number, number>;
    lanIpOverride: Schema<string, string>;
    pinEnabled: Schema<boolean, boolean>;
    customPin: Schema<string, string>;
    heartbeatInterval: Schema<number, number>;
    dshHome: Schema<string, string>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
