import { once } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);

const nodeEnvironment: unknown = require("next/dist/server/node-environment");

record(nodeEnvironment);

const errorHandlers: unknown = require("next/dist/server/app-render/create-error-handler");

const createReactServerErrorHandler = (() => {
  const handler = record(errorHandlers).createReactServerErrorHandler;

  if (typeof handler !== "function") {
    throw new Error("Missing Next RSC error handler");
  }

  return handler;
})();

interface FlightServer {
  renderToPipeableStream(
    model: unknown,
    modules: Record<string, never>,
    options: { onError: (error: unknown) => string | undefined },
  ): { pipe: (destination: PassThrough) => PassThrough };
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Invalid Next runtime export");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const variants = [
  "app-page.runtime.dev.js",
  "app-page.runtime.prod.js",
  "app-page-turbo.runtime.dev.js",
  "app-page-turbo.runtime.prod.js",
  "app-page-experimental.runtime.dev.js",
  "app-page-experimental.runtime.prod.js",
  "app-page-turbo-experimental.runtime.dev.js",
  "app-page-turbo-experimental.runtime.prod.js",
];

for (const variant of variants) {
  test.describe(variant, () => {
    function renderer(): FlightServer {
      const runtime: unknown = require(`next/dist/compiled/next-server/${variant}`);
      const servers = record(record(record(runtime).vendored)["react-rsc"]);
      const server = record(
        servers[
          variant.includes("turbo")
            ? "ReactServerDOMTurbopackServer"
            : "ReactServerDOMWebpackServer"
        ],
      );
      const renderToPipeableStream = server.renderToPipeableStream;

      if (typeof renderToPipeableStream !== "function") {
        throw new Error("Missing Next RSC renderer");
      }

      return {
        renderToPipeableStream(model, modules, options) {
          const pipeable: unknown = Reflect.apply(renderToPipeableStream, server, [
            model,
            modules,
            options,
          ]);
          const result = record(pipeable);
          const pipe = result.pipe;

          if (typeof pipe !== "function") {
            throw new Error("Missing RSC pipe method");
          }

          return {
            pipe(destination) {
              const stream: unknown = Reflect.apply(pipe, result, [destination]);

              if (!(stream instanceof PassThrough)) {
                throw new Error("Invalid RSC destination");
              }

              return stream;
            },
          };
        },
      };
    }

    function render(model: unknown) {
      const reported: unknown[] = [];
      const cancellations: unknown[] = [];
      const handleError: unknown = Reflect.apply(createReactServerErrorHandler, undefined, [
        false,
        false,
        new Map(),
        (error: unknown) => reported.push(error),
      ]);

      if (typeof handleError !== "function") {
        throw new Error("Invalid RSC error handler");
      }

      const stream = new PassThrough();
      const pipeable = renderer().renderToPipeableStream(
        model,
        {},
        {
          onError(error) {
            cancellations.push(error);
            const digest: unknown = Reflect.apply(handleError, undefined, [error]);

            if (digest !== undefined && typeof digest !== "string") {
              throw new Error("Invalid RSC error digest");
            }

            return digest;
          },
        },
      );

      return { stream, pipeable, reported, cancellations };
    }

    test("canceling a pending response does not report a render error", async () => {
      const { stream, pipeable, reported, cancellations } = render({
        pending: new Promise<never>(() => {}),
      });
      const firstChunk = once(stream, "data");
      stream.resume();
      pipeable.pipe(stream);
      await firstChunk;
      const closed = once(stream, "close");
      stream.destroy();
      await closed;
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0]).toMatchObject({ name: "ResponseAborted" });
      expect(reported).toEqual([]);
    });

    test("completed responses remain successful", async () => {
      const { stream, pipeable, reported, cancellations } = render({ value: "complete" });
      const ended = once(stream, "end");
      stream.resume();
      pipeable.pipe(stream);
      await ended;
      expect(stream.writableEnded).toBe(true);
      expect(cancellations).toEqual([]);
      expect(reported).toEqual([]);
    });

    test("genuine render failures are still reported", async () => {
      let rejectPending: (reason: Error) => void = () => {};
      const pending = new Promise<never>((_, reject) => {
        rejectPending = reject;
      });
      const { stream, pipeable, reported } = render({ pending });
      const firstChunk = once(stream, "data");
      const ended = once(stream, "end");
      stream.resume();
      pipeable.pipe(stream);
      await firstChunk;
      rejectPending(new Error("Real server render failure"));
      await ended;
      expect(reported).toHaveLength(1);
      expect(reported[0]).toMatchObject({ message: "Real server render failure" });
      expect(reported[0]).toHaveProperty("digest", expect.any(String));
    });
  });
}
