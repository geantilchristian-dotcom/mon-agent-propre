import express, { type Express } from "express";
  import cors from "cors";
  import pinoHttp from "pino-http";
  import router from "./routes";
  import { logger } from "./lib/logger";
  import path from "path";
  import { existsSync } from "fs";

  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", router);

  // In production (Render), serve the built React frontend
  if (process.env.NODE_ENV === "production") {
    const staticPath = path.join(process.cwd(), "artifacts/agent-ide/dist/public");
    if (existsSync(staticPath)) {
      app.use(express.static(staticPath));
      // Express 5 wildcard syntax: "/{*splat}"
      app.get("/{*splat}", (_req, res) => {
        res.sendFile(path.join(staticPath, "index.html"));
      });
      logger.info({ staticPath }, "Serving static frontend");
    } else {
      logger.warn({ staticPath }, "Static frontend not found — API only");
    }
  }

  export default app;
  