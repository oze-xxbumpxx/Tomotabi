import type { TodoList } from "@tomotabi/contracts";
import type {
  ListTodosInput,
  ListTodosInputPort,
} from "../adapter/inbound/todo.input-port.js";
import type { PlanningReadPort } from "../adapter/outbound/planning-read.port.js";
import { toTodoDto } from "./todo-dto.js";
import { toTodoCategoryDto } from "./todo-category-write-flow.js";
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
    const view = await this.read.listTodos(input.tripId);
    return {
      categories: view.categories.map(toTodoCategoryDto),
      items: view.items.map((item) => toTodoDto(item.todo, item.plan)),
    };
  }
}
