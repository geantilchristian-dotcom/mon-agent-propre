import { Router, type IRouter } from "express";
import healthRouter from "./health";
import githubRouter from "./github";
import chatRouter from "./chat";
import { agentRouter } from "./agent";

const router: IRouter = Router();

router.use(healthRouter);
router.use(githubRouter);
router.use(chatRouter);
router.use(agentRouter);

export default router;
