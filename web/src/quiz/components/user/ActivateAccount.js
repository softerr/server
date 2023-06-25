import { useEffect, useState } from "react";
import { Container, Spinner } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import NotFound from "../../layouts/NotFound";
import { activate } from "../../services";

const ActivateAccount = () => {
    const { token } = useParams();
    const navigate = useNavigate();
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        activate(token,
            () => navigate("/quiz/login", { replace: true, state: { message: "Account was successfully activated." } }),
            res => {
                setFailed(true);
                console.log(res);
            }
        );
    }, []);

    return failed ? (
        <NotFound />
    ) : (
        <Container fluid="sm" className="d-flex justify-content-center" style={{ marginTop: "100px" }}>
            <Spinner animation="border" variant="primary" />
        </Container>
    );
};

export default ActivateAccount;
