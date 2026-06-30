import { Router, type IRouter } from "express";
import healthRouter from "./health";
import githubRouter from "./github";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(githubRouter);
router.use(chatRouter);

export default router;
