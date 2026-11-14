import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import type {
  TodoCategory,
  TodoCategoryDeletion,
  TodoCategoryOrder,
} from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id.js";
import { CurrentUser } from "../../../common/guard/current-user.decorator.js";
import { parseExpectedVersion } from "../../../common/http/expected-version.js";
import { parseIdempotencyKey } from "../../../common/http/idempotency-key.js";
import { computeRequestHash } from "../../../common/idempotency/command-receipt.js";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe.js";
import {
  CreateTodoCategoryBody,
  CreateTodoCategoryParams,
  DeleteTodoCategoryBody,
  DeleteTodoCategoryParams,
  ReorderTodoCategoriesBody,
  ReorderTodoCategoriesParams,
  UpdateTodoCategoryBody,
  UpdateTodoCategoryParams,
} from "../../../generated/planning.zod.js";
import {
  CREATE_TODO_CATEGORY_INPUT_PORT,
  CREATE_TODO_CATEGORY_OPERATION,
  DELETE_TODO_CATEGORY_INPUT_PORT,
  DELETE_TODO_CATEGORY_OPERATION,
  REORDER_TODO_CATEGORIES_INPUT_PORT,
  REORDER_TODO_CATEGORIES_OPERATION,
  UPDATE_TODO_CATEGORY_INPUT_PORT,
  UPDATE_TODO_CATEGORY_OPERATION,
  type CreateTodoCategoryInputPort,
  type DeleteTodoCategoryInputPort,
  type ReorderTodoCategoriesInputPort,
  type UpdateTodoCategoryInputPort,
} from "../adapter/inbound/todo-category.input-port.js";
import type { TodoWriteResult } from "../adapter/inbound/todo.input-port.js";

type TripParams = zod.infer<typeof CreateTodoCategoryParams>;
type OrderParams = zod.infer<typeof ReorderTodoCategoriesParams>;
type CategoryParams = zod.infer<typeof UpdateTodoCategoryParams>;
type CreateTodoCategoryBodyInput = zod.infer<typeof CreateTodoCategoryBody>;
type UpdateTodoCategoryBodyInput = zod.infer<typeof UpdateTodoCategoryBody>;
type ReorderTodoCategoriesBodyInput = zod.infer<
  typeof ReorderTodoCategoriesBody
>;
type DeleteTodoCategoryBodyInput = zod.infer<typeof DeleteTodoCategoryBody>;

/** 旅行のToDoのカテゴリ（設計書 todo-organize「API 設計」）。 */
@Controller("trips")
export class TodoCategoriesController {
  constructor(
    @Inject(CREATE_TODO_CATEGORY_INPUT_PORT)
    private readonly createTodoCategory: CreateTodoCategoryInputPort,
    @Inject(UPDATE_TODO_CATEGORY_INPUT_PORT)
    private readonly updateTodoCategory: UpdateTodoCategoryInputPort,
    @Inject(REORDER_TODO_CATEGORIES_INPUT_PORT)
    private readonly reorderTodoCategories: ReorderTodoCategoriesInputPort,
    @Inject(DELETE_TODO_CATEGORY_INPUT_PORT)
    private readonly deleteTodoCategory: DeleteTodoCategoryInputPort,
  ) {}

  @Post(":tripId/todo-categories")
  async create(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CreateTodoCategoryParams)) params: TripParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Body(new ZodBodyPipe(CreateTodoCategoryBody))
    body: CreateTodoCategoryBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TodoCategory> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: CREATE_TODO_CATEGORY_OPERATION,
      tripId: params.tripId,
      resourceId: null,
      body,
      ifMatch: null,
    });
    const result = await this.createTodoCategory.execute({
      userId,
      tripId: params.tripId,
      key,
      requestHash,
      name: body.name,
    });
    return this.writeResult(response, result);
  }

  @Patch(":tripId/todo-categories/:categoryId")
  async update(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(UpdateTodoCategoryParams)) params: CategoryParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("x-expected-version") versionHeader: string | undefined,
    @Body(new ZodBodyPipe(UpdateTodoCategoryBody))
    body: UpdateTodoCategoryBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TodoCategory> {
    const key = parseIdempotencyKey(keyHeader);
    const ifMatch = parseExpectedVersion(versionHeader);
    const requestHash = computeRequestHash({
      operation: UPDATE_TODO_CATEGORY_OPERATION,
      tripId: params.tripId,
      resourceId: params.categoryId,
      body,
      ifMatch,
    });
    const result = await this.updateTodoCategory.execute({
      userId,
      tripId: params.tripId,
      categoryId: params.categoryId,
      key,
      ifMatch,
      requestHash,
      name: body.name,
    });
    return this.writeResult(response, result);
  }

  @Put(":tripId/todo-categories/order")
  async reorder(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(ReorderTodoCategoriesParams)) params: OrderParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Body(new ZodBodyPipe(ReorderTodoCategoriesBody))
    body: ReorderTodoCategoriesBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TodoCategoryOrder> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: REORDER_TODO_CATEGORIES_OPERATION,
      tripId: params.tripId,
      resourceId: params.tripId,
      body,
      ifMatch: null,
    });
    const result = await this.reorderTodoCategories.execute({
      userId,
      tripId: params.tripId,
      key,
      requestHash,
      from: body.from,
      to: body.to,
    });
    return this.writeResult(response, result);
  }

  @Post(":tripId/todo-categories/:categoryId/delete")
  async remove(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(DeleteTodoCategoryParams)) params: CategoryParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Body(new ZodBodyPipe(DeleteTodoCategoryBody))
    body: DeleteTodoCategoryBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TodoCategoryDeletion> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: DELETE_TODO_CATEGORY_OPERATION,
      tripId: params.tripId,
      resourceId: params.categoryId,
      body,
      ifMatch: null,
    });
    const result = await this.deleteTodoCategory.execute({
      userId,
      tripId: params.tripId,
      categoryId: params.categoryId,
      key,
      requestHash,
      expectedTodoCount: body.expectedTodoCount,
    });
    return this.writeResult(response, result);
  }

  private writeResult<T>(response: Response, result: TodoWriteResult<T>): T {
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }
}
