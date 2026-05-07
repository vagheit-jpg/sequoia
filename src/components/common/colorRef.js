import { DARK } from "../../constants/theme";

// App.jsx가 매 렌더마다 setC(C)를 호출하여 최신 색상 객체를 동기화한다.
// 분리된 공통 컴포넌트들은 이 ref를 통해 C를 참조한다.
const colorRef = { current: DARK };

export default colorRef;
