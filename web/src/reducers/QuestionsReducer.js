const QuestionsReducer = (state = { questions: [] }, action) => {
    switch (action.type) {
        case "QUESTIONS_SET":
            state.questions[action.quizId] = action.questions;
            return { questions: state.questions };
        case "QUESTIONS_SET_QUESTION":
            state.questions[action.quizId] = state.questions[action.quizId].map(question => (question.id === action.question.id ? action.question : question));
            return { questions: state.questions };
        case "QUESTIONS_ADD":
            state.questions[action.quizId].push(action.question);
            return { questions: state.questions };
        case "QUESTIONS_DEL":
            state.questions[action.quizId] = state.questions[action.quizId].filter(question => question.quiz_id !== action.quizId || question.id !== action.id);
            return { questions: state.questions };
        default:
            return state;
    }
};

export default QuestionsReducer;
