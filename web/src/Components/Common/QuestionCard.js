import { Button, Card, Col, Row } from "react-bootstrap";
import { Check, PencilSquare, Trash } from "react-bootstrap-icons";
import { Link } from "react-router-dom";

const QuestionCard = ({ index, question, onEdit, onDelete }) => {
    return (
        <Card className="w-100" style={{ border: "1px solid #e8e8e8" }}>
            <Card.Header style={{ borderBottom: "0px", backgroundColor: "#e8e8e8" }}>
                <Row className="g-3">
                    <Col xs={"auto"} className="d-flex flex-grow-1 align-items-center">
                        {index + 1}. {question.type_label}
                    </Col>
                    {onEdit && (
                        <Col xs={"auto"}>
                            <Button variant="primary" className="p-1 icon-button d-flex align-items-center justify-content-center" as={Link} to={onEdit} state={{ question }}>
                                <PencilSquare size={16} />
                            </Button>
                        </Col>
                    )}
                    {onDelete && (
                        <Col xs={"auto"}>
                            <Button variant="danger" className="p-1 icon-button d-flex align-items-center justify-content-center" onClick={onDelete}>
                                <Trash size={16} />
                            </Button>
                        </Col>
                    )}
                </Row>
            </Card.Header>
            <Card.Body>
                <Card.Title>{question.question}</Card.Title>
                {question.type_id !== 6 && question.type_id !== 9 && <hr className="mb-0" />}
                {(question.type_id === 1 || question.type_id === 2) && (
                    <Row xs={1} md={2} lg={3} className="g-4 mt-auto" style={{ marginLeft: "0.08rem", marginRight: "0.08rem" }}>
                        {question.answers.map(answer => (
                            <Col key={answer.id} className="d-flex justify-content-center">
                                <Card.Text>{answer.answer}</Card.Text>
                                {answer.correct === 1 && <Check color="green" size={24} />}
                            </Col>
                        ))}
                    </Row>
                )}
                {question.type_id === 3 && <div style={{ marginTop: "25px" }}>{question.answers[0].correct ? "True" : "False"}</div>}
                {question.type_id === 4 && <div style={{ marginTop: "25px" }}>{question.answers[0].correct ? "Yes" : "No"}</div>}
                {(question.type_id === 5 || question.type_id === 7 || question.type_id === 8) && <div style={{ marginTop: "25px" }}>{question.answers[0].answer}</div>}
            </Card.Body>
        </Card>
    );
};

export default QuestionCard;
