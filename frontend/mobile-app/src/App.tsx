import { Route, Switch } from "wouter";
import IngestionPage from "./pages/IngestionPage";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={IngestionPage} />
      <Route path="/ingestions" component={IngestionPage} />
      <Route component={IngestionPage} />
    </Switch>
  );
}
