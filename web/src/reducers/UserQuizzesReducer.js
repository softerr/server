const UserQuizzesReducer = (state = { userQuizzes: [] }, action) => {
    switch (action.type) {
        case "USER_QUIZZES_SET":
            state.userQuizzes[action.userId] = action.userQuizzes;
            return { userQuizzes: state.userQuizzes };
        case "USER_QUIZZES_SET_QUIZ":
            state.userQuizzes[action.userId] = state.userQuizzes[action.userId].map(quiz => (quiz.id === action.quiz.id ? action.quiz : quiz));
            return { userQuizzes: state.userQuizzes };
        case "USER_QUIZZES_SET_QUESTION_COUNT":
            state.userQuizzes[action.userId] = state.userQuizzes[action.userId].map(quiz => (quiz.id === action.quizId ? { ...quiz, question_count: action.question_count } : quiz));
            return { userQuizzes: state.userQuizzes };
        case "USER_QUIZZES_ADD":
            state.userQuizzes[action.userId].push(action.quiz);
            return { userQuizzes: state.userQuizzes };
        case "USER_QUIZZES_DEL":
            state.userQuizzes[action.userId] = state.userQuizzes[action.userId].filter(quiz => quiz.user_id !== action.userId || quiz.id !== action.id);
            return { userQuizzes: state.userQuizzes };
        default:
            return state;
    }
};

export default UserQuizzesReducer;
