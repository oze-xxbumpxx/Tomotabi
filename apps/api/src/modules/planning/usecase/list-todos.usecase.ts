import type { TodoList } from "@tomotabi/contracts";
import type {
  ListTodosInput,
  ListTodosInputPort,
} from "../adapter/inbound/todo.input-port.js";
import type { PlanningReadPort } from "../adapter/outbound/planning-read.port.js";
import { toTodoDto } from "./todo-dto.js";
import { tripNotAccessible } from "./trip-write-flow.js";

export class ListTodosUseCase implements ListTodosInputPort {
  constructor(private readonly read: PlanningReadPort) {}

  async execute(input: ListTodosInput): Promise<TodoList> {
    const trip = await this.read.findTripForParticipant(
      input.tripId,
      input.userId,
    );
    if (trip === null) {
      throw tripNotAccessible();
    }
    const views = await this.read.listTodos(input.tripId);
    return { items: views.map((view) => toTodoDto(view.todo, view.plan)) };
  }
}
