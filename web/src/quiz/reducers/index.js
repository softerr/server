import { combineReducers } from "redux";
import UserReducer from "./UserReducer";
import UserQuizzesReducer from "./UserQuizzesReducer";
import QuestionsReducer from "./QuestionsReducer";
import PublicQuizzesReducer from "./PublicQuizzesReducer";
import ModQuizzesReducer from "./ModQuizzesReducer";
import UsersReducer from "./UsersReducer";
import RolesReducer from "./RolesReducer";
import TypesReducer from "./TypesReducer";

const quizReducers = combineReducers({
    user: UserReducer,
    userQuizzes: UserQuizzesReducer,
    questions: QuestionsReducer,
    publicQuizzes: PublicQuizzesReducer,
    modQuizzes: ModQuizzesReducer,
    users: UsersReducer,
    roles: RolesReducer,
    types: TypesReducer,
});

export default quizReducers;
