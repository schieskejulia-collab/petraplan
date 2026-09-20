import { Redirect, Route, Switch } from "wouter";
import CasesPage from "./pages/CasesPage";
import CaseDetailPage from "./pages/CaseDetailPage";
import BridgePage from "./pages/BridgePage";
import UnifiedTracePage from "./pages/UnifiedTracePage";
import GovernanceProofPage from "./pages/GovernanceProofPage";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/cases" />} />
      <Route path="/cases" component={CasesPage} />
      <Route path="/cases/:caseId" component={CaseDetailPage} />
      <Route path="/bridge" component={BridgePage} />
      <Route path="/trace" component={UnifiedTracePage} />
      <Route path="/governance-proof" component={GovernanceProofPage} />
      <Route component={() => <Redirect to="/cases" />} />
    </Switch>
  );
}
