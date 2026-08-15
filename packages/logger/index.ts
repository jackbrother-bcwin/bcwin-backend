import { stdout } from "process";
import { inspect } from "util";

const COLORS = {
    RESET: "\x1b[0m",
    YELLOW: "\x1b[33m",
    CYAN: "\x1b[36m",
    RED: "\x1b[31m",
    MAGENTA: "\x1b[35m",
    GRAY: "\x1b[90m",
    GREEN: "\x1b[32m",
};

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

type LogPrefix = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogOptions {
    beautify?: boolean;
}

class Logger {
    private key: string;
    private time: Map<string, Date> = new Map<string, Date>();
    private isProgressActive: boolean = false;
    static level: LogLevel =
        process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG;

    constructor(key: string) {
        this.key = key.toUpperCase();
    }

    private format(
        prefix: LogPrefix,
        color: string,
        message: string,
        additionalInfo?: any,
        options?: LogOptions
    ): void {
        const formattedMessage = `${color}${prefix}:${COLORS.MAGENTA} [${this.key}] ${color}${message}${COLORS.RESET}`;

        let formattedInfo = "";
        if (additionalInfo !== undefined) {
            const shouldBeautify =
                options?.beautify &&
                typeof additionalInfo === "object" &&
                additionalInfo !== null &&
                !(additionalInfo instanceof Error);

            const stringifiedInfo = shouldBeautify
                ? JSON.stringify(additionalInfo, null, 2)
                : JSON.stringify(additionalInfo);

            formattedInfo = `${COLORS.GRAY}${stringifiedInfo}${COLORS.RESET}`;
        }

        // Write to console
        if (prefix === "WARN") {
            if (additionalInfo instanceof Error) {
                console.warn(formattedMessage, additionalInfo);
            } else {
                console.warn(formattedMessage, formattedInfo);
            }
        } else {
            console.log(formattedMessage, formattedInfo);
        }
    }

    public debug(
        message: string,
        additionalInfo?: any,
        options?: LogOptions
    ): void {
        if (Logger.level <= LogLevel.DEBUG) {
            this.format(
                "DEBUG",
                COLORS.GREEN,
                message,
                additionalInfo,
                options
            );
        }
    }

    public info(
        message: string,
        additionalInfo?: any,
        options?: LogOptions
    ): void {
        if (Logger.level <= LogLevel.INFO) {
            this.format("INFO", COLORS.CYAN, message, additionalInfo, options);
        }
    }

    public warn(
        message: string,
        additionalInfo?: any,
        options?: LogOptions
    ): void {
        if (Logger.level <= LogLevel.WARN) {
            this.format(
                "WARN",
                COLORS.YELLOW,
                message,
                additionalInfo,
                options
            );
        }
    }

    public error(...args: any[]): void {
        if (Logger.level <= LogLevel.ERROR) {
            const formattedArgs = args.map((arg) =>
                typeof arg === "object"
                    ? inspect(arg, {
                          depth: null,
                          colors: true,
                          compact: false,
                          maxArrayLength: null,
                      })
                    : arg
            );

            // Console output
            console.error(
                `${COLORS.RED}ERROR:${COLORS.MAGENTA} [${this.key}] ${COLORS.RESET}`,
                ...formattedArgs
            );
        }
    }

    public progress(
        current: number,
        total: number,
        label: string = "",
        barWidth: number = 30
    ): void {
        if (Logger.level <= LogLevel.DEBUG) {
            return;
        }

        if (total <= 0) {
            this.warn("Progress total must be positive", { label, total });
            return;
        }

        const prefix = "PROGRESS";

        const currentClamped = Math.max(0, Math.min(current, total));

        const percentage = (currentClamped / total) * 100;
        const filledWidth = Math.round(barWidth * (currentClamped / total));
        const emptyWidth = barWidth - filledWidth;

        const filledBar = COLORS.GREEN + "█".repeat(filledWidth);
        const emptyBar = COLORS.GRAY + "-".repeat(emptyWidth) + COLORS.RESET;
        const bar = `[${filledBar}${emptyBar}]`;

        const percentageString = percentage.toFixed(1).padStart(5, " ");

        const labelString = label
            ? `${COLORS.CYAN}${label}: ${COLORS.RESET}`
            : "";
        const keyString = `${COLORS.GREEN}${prefix}:${COLORS.MAGENTA} [${this.key}] ${COLORS.RESET}`;

        const output = `${keyString}${labelString}${bar} ${percentageString}% (${currentClamped}/${total})    `;

        stdout.write("\r" + output);
        this.isProgressActive = true;

        // * use isProgressActive to maybe lock the logger until the progress is finished or find another way to not to mess up progress bar
        if (currentClamped === total) {
            stdout.write("\n");
            this.isProgressActive = false;
        }
    }

    public start(label: string) {
        if (Logger.level <= LogLevel.DEBUG) {
            this.time.set(label, new Date());
        }
    }

    public end(label: string) {
        if (!this.time.has(label)) return;

        if (Logger.level <= LogLevel.DEBUG) {
            const time = this.time.get(label)!;
            let duration = new Date().getTime() - time.getTime();
            let suffix = "ms";

            if (duration > 1000) {
                duration /= 1000;
                suffix = "s";
            }

            this.debug(`${label} finished`, {
                duration: `${duration}${suffix}`,
            });

            this.time.delete(label);
        }
    }

    static setLogLevel(level: LogLevel): void {
        Logger.level = level;
    }
}

export default Logger;
