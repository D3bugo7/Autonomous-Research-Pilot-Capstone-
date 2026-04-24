from langgraph.graph import StateGraph, END
from app.state import ResearchState
from app.nodes.research_nodes import (
    retrieve_node,
    claims_node,
    synthesize_node,
)

def build_graph():
    g = StateGraph(ResearchState)

    g.add_node("retrieve", retrieve_node)
    g.add_node("claims", claims_node)
    g.add_node("synthesize", synthesize_node)

    g.set_entry_point("retrieve")

    g.add_edge("retrieve", "claims")
    g.add_edge("claims", "synthesize")
    g.add_edge("synthesize", END)

    return g.compile()