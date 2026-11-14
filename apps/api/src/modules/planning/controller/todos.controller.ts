import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import type { Todo, TodoDeletion, TodoList } from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id.js";
import { CurrentUser } from "../../../common/guard/current-user.decorator.js";
import { parseExpectedVersion } from "../../../common/http/expected-version.js";
import { parseIdempotencyKey } from "../../../common/http/idempotency-key.js";
import { computeRequestHash } from "../../../common/idempotency/command-receipt.js";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe.js";
import {
  CompleteTodoParams,
  CreateTodoBody,
  CreateTodoParams,
  DeleteTodoParams,
  ListTodosParams,
  ReopenTodoParams,
  UpdateTodoBody,
  UpdateTodoParams,
} from "../../../generated/planning.zod.js";
import {
  COMPLETE_TODO_INPUT_PORT,
  COMPLETE_TODO_OPERATION,
  CREATE_TODO_INPUT_PORT,
  CREATE_TODO_OPERATION,
  DELETE_TODO_INPUT_PORT,
  DELETE_TODO_OPERATION,
  LIST_TODOS_INPUT_PORT,
  REOPEN_TODO_INPUT_PORT,
  REOPEN_TODO_OPERATION,
  UPDATE_TODO_INPUT_PORT,
  UPDATE_TODO_OPERATION,
  type CompleteTodoInputPort,
  type CreateTodoInputPort,
  type DeleteTodoInputPort,
  type ListTodosInputPort,
  type ReopenTodoInputPort,
  type TodoWriteResult,
  type UpdateTodoInputPort,
} from "../adapter/inbound/todo.input-port.js";

type TripParams = zod.infer<typeof ListTodosParams>;
type TodoParams = zod.infer<typeof UpdateTodoParams>;
type CreateTodoBodyInput = zod.infer<typeof CreateTodoBody>;
type UpdateTodoBodyInput = zod.infer<typeof UpdateTodoBody>;

/** 旅行のToDo（設計書 trip-todo「API 設計」）。書き込みはどれもPOST・PATCH。 */
@Controller("trips")
export class TodosController {
  constructor(
    @Inject(LIST_TODOS_INPUT_PORT)
    private readonly listTodos: ListTodosInputPort,
    @Inject(CREATE_TODO_INPUT_PORT)
    private readonly createTodo: CreateTodoInputPort,
    @Inject(UPDATE_TODO_INPUT_PORT)
    private readonly updateTodo: UpdateTodoInputPort,
    @Inject(COMPLETE_TODO_INPUT_PORT)
    private readonly completeTodo: CompleteTodoInputPort,
    @Inject(REOPEN_TODO_INPUT_PORT)
    private readonly reopenTodo: ReopenTodoInputPort,
    @Inject(DELETE_TODO_INPUT_PORT)
    private readonly deleteTodo: DeleteTodoInputPort,
  ) {}

  @Get(":tripId/todos")
  async list(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(ListTodosParams)) params: TripParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TodoList> {
    response.setHeader("Cache-Control", "private, no-store");
    return this.listTodos.execute({ userId, tripId: params.tripId });
  }

  @Post(":tripId/todos")
  async create(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CreateTodoParams)) params: TripParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Body(new ZodBodyPipe(CreateTodoBody)) body: CreateTodoBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Todo> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: CREATE_TODO_OPERATION,
      tripId: params.tripId,
      resourceId: null,
      body,
      ifMatch: null,
    });
    const result = await this.createTodo.execute({
      userId,
      tripId: params.tripId,
      key,
      requestHash,
      name: body.name,
      categoryId: body.categoryId ?? null,
      planId: body.planId ?? null,
    });
    return this.writeResult(response, result);
  }

  @Patch(":tripId/todos/:todoId")
  async update(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(UpdateTodoParams)) params: TodoParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("x-expected-version") versionHeader: string | undefined,
    @Body(new ZodBodyPipe(UpdateTodoBody, { nonEmptyObject: true }))
    body: UpdateTodoBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Todo> {
    const key = parseIdempotencyKey(keyHeader);
    const ifMatch = parseExpectedVersion(versionHeader);
    const requestHash = computeRequestHash({
      operation: UPDATE_TODO_OPERATION,
      tripId: params.tripId,
      resourceId: params.todoId,
      body,
      ifMatch,
    });
    const result = await this.updateTodo.execute({
      userId,
      tripId: params.tripId,
      todoId: params.todoId,
      key,
      ifMatch,
      requestHash,
      name: body.name,
      memo: body.memo,
      categoryId: body.categoryId,
      assigneeId: body.assigneeId,
      dueOn: body.dueOn,
      planId: body.planId,
    });
    return this.writeResult(response, result);
  }

  @Post(":tripId/todos/:todoId/complete")
  async complete(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CompleteTodoParams)) params: TodoParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Todo> {
    const result = await this.completeTodo.execute(
      this.command(userId, params, keyHeader, COMPLETE_TODO_OPERATION),
    );
    return this.writeResult(response, result);
  }

  @Post(":tripId/todos/:todoId/reopen")
  async reopen(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(ReopenTodoParams)) params: TodoParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Todo> {
    const result = await this.reopenTodo.execute(
      this.command(userId, params, keyHeader, REOPEN_TODO_OPERATION),
    );
    return this.writeResult(response, result);
  }

  @Post(":tripId/todos/:todoId/delete")
  async remove(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(DeleteTodoParams)) params: TodoParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TodoDeletion> {
    const result = await this.deleteTodo.execute(
      this.command(userId, params, keyHeader, DELETE_TODO_OPERATION),
    );
    return this.writeResult(response, result);
  }

  private command(
    userId: UserId,
    params: TodoParams,
    keyHeader: string | undefined,
    operation: string,
  ) {
    return {
      userId,
      tripId: params.tripId,
      todoId: params.todoId,
      key: parseIdempotencyKey(keyHeader),
      requestHash: computeRequestHash({
        operation,
        tripId: params.tripId,
        resourceId: params.todoId,
        body: null,
        ifMatch: null,
      }),
    };
  }

  private writeResult<T>(response: Response, result: TodoWriteResult<T>): T {
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }
}
