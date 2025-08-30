#!/usr/bin/env python3
#analyze_cli.py
import argparse
import asyncio
import base64
import json
import os
import sys
from typing import List, Optional, Dict, Any, Literal

from pydantic import BaseModel
# Uses your existing OpenAI Agents SDK
from agents import Agent, Runner, function_tool

# =========================
# Types
# =========================

class Component(BaseModel):
    id: str
    name: str
    type: str  # e.g. service, database, queue

class Connection(BaseModel):
    from_id: str
    to_id: str
    type: str  # e.g. HTTP, message, DB

class ArchitectureDiagram(BaseModel):
    components: List[Component]
    connections: List[Connection]

class RubricScore(BaseModel):
    category: str  # e.g. "requirements", "feed", "media", "data", ...
    score: int     # 0-5
    comment: str

class LiveAssessment(BaseModel):
    scores: List[RubricScore]
    top_gaps: List[str]
    suggested_next_question: str

_LAST_LIVE: Optional[LiveAssessment] = None


# capture the last tool output so we can return structured JSON to Node
_LAST_PARSED_DIAGRAM: Optional[ArchitectureDiagram] = None

WhiteboardState = Literal["none", "blank", "has_content", "unknown"]
_LAST_WHITEBOARD: Optional[Dict[str, Any]] = None  


# =========================
# Vision Tool
# =========================

@function_tool
def parse_architecture_diagram(description: str) -> ArchitectureDiagram:
    """
    Extract system components and their connections from a system diagram description.
    The Agent is expected to call this with structured content it inferred from the image.
    """
    # NOTE: We intentionally do not parse here; the Agent provides the structure.
    # You can add validation/post-processing later if you wish.
    global _LAST_PARSED_DIAGRAM
    _LAST_PARSED_DIAGRAM = ArchitectureDiagram(components=[], connections=[])
    return _LAST_PARSED_DIAGRAM

def image_to_b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


# =========================
# Whiteboard Tool
# =========================

@function_tool
def classify_whiteboard(state: WhiteboardState, app: Optional[str] = None) -> Dict[str, Any]:
    """
    Classify whether the screenshot shows a whiteboard and if it is blank or has content.
    """
    global _LAST_WHITEBOARD
    _LAST_WHITEBOARD = {"state": state, "app": app}
    return _LAST_WHITEBOARD

def _infer_whiteboard_state_from_text(txt: str) -> Dict[str, Any]:
    t = (txt or "").lower()
    if any(k in t for k in ["whiteboard", "miro", "excalidraw", "jamboard", "figma", "canvas"]):
        if any(k in t for k in ["blank", "empty", "no content", "nothing drawn"]):
            return {"state": "blank"}
        if any(k in t for k in ["diagram", "component", "box", "arrow", "content", "drawing"]):
            return {"state": "has_content"}
        return {"state": "blank"}  # conservative OK to proceed
    if any(k in t for k in ["no whiteboard", "not a whiteboard", "does not show a whiteboard"]):
        return {"state": "none"}
    return {"state": "unknown"}


# =========================
# Vision Agent
# =========================

VISION_INSTRUCTIONS = (
    "You are a system architecture parser. "
    "First determine if the image shows a WHITEBOARD app. "
    "If yes, call `classify_whiteboard` with state='blank' or 'has_content' and app name if known. "
    "If no, call `classify_whiteboard` with state='none'. "
    "If unsure, use state='unknown'. "
    "If you can see a drawn system diagram, also call `parse_architecture_diagram` with components/connections."
)

vision_agent = Agent(
    name="DiagramParsingAgent",
    instructions=VISION_INSTRUCTIONS,
    tools=[parse_architecture_diagram, classify_whiteboard],
)

# =========================
# Live Coach 
# =========================

@function_tool
def report_live_assessment(payload: LiveAssessment) -> Dict[str, Any]:
    global _LAST_LIVE
    _LAST_LIVE = payload
    return payload.model_dump()

live_coach_agent = Agent(
    name="LiveCoachAgent",
    instructions="""
You are coaching a system-design interviewer in real time.
Read the merged document (requirements + last diagram summary + recent transcript).
Output ONE call to report_live_assessment with:
- scores: list of categories with 0–5 scores and a brief comment
- top_gaps: 3–5 specific missing items to dig into next
- suggested_next_question: one concrete question that advances the interview

Scoring rubric, prioritize (Instagram):
- requirements, data model, media pipeline (upload/transcode/CDN), feed generation (push/pull/ranking),
  caching, scale & reliability, consistency/availability, observability, security.
""",
    tools=[report_live_assessment],
)

# =========================
# Assessment Panel + Synthesis
# =========================

assessment_agents: List[Agent] = [
    Agent(
        name="InteractionQualityAgent",
        instructions="""
        You are an expert interviewer for system design interviews. 
        Your job is to analyze the interviewee’s behavior in the transcript.

        Look for:
        - Whether they **ask clarifying questions** about functional and non-functional requirements.
        - Whether they **verify assumptions** and **communicate tradeoffs**.
        - If they **explain their design choices clearly** or remain vague/silent.
        - How structured and confident their **verbal reasoning** appears.
        - Whether they are collaborative or passive in the discussion.

        Give a brief summary of strengths, areas for improvement, and an overall interaction quality rating (1-10).
        """
    ),
    Agent(
        name="StructuredApproachAgent",
        instructions="""
        You are assessing whether the interviewee follows a structured approach to system design.

        Look for the following stages in their reasoning:
        1. Clarifying **high-level requirements**
        2. Identifying **non-functional requirements** (e.g. scalability, availability)
        3. Outlining a **high-level architecture** (components, interactions)
        4. **Drilling down** into key components or flows
        5. Discussing **trade-offs** between options

        Evaluate whether the approach is logical, complete, and well-sequenced. Note any missing or weak steps and give a brief summary.
        """
    ),
    Agent(
        name="OverEngineeringAgent",
        instructions="""
        You are assessing whether the proposed architecture is overly complex for the problem at hand.

        Look for signs of over-engineering:
        - Use of advanced tools, patterns, or infra that don’t align with stated requirements
        - Premature optimization
        - Too many components, layers, or abstractions
        - Heavy reliance on non-essential services or technologies

        Provide a short summary of any over-engineering, unnecessary complexity, or risks of maintainability. Offer a simpler alternative if applicable.
        """
    ),
    Agent(
        name="RequirementCoverageAgent",
        instructions="You are an expert in validating system design against given requirements. Read the document and list each requirement along with whether it's fully, partially, or not addressed. Justify briefly."
    ),
    Agent(
        name="LogicalFlowAgent",
        instructions="You analyze logical flow in system designs. Review the content and highlight any logical inconsistencies, gaps, or contradictory elements in the architecture."
    ),
    Agent(
        name="BottleneckAgent",
        instructions="You're an expert in system scalability and performance. Identify any potential bottlenecks or scaling issues in the described architecture and suggest improvements."
    ),
    Agent(
        name="OptimalityAgent",
        instructions="You evaluate architecture designs for best practices. Rate the design on simplicity, modularity, and future-proofing. Suggest how it could be made more optimal."
    ),
    Agent(
        name="PatternRecognitionAgent",
        instructions="You identify software architecture patterns. List any patterns used in this system (e.g., CQRS, pub/sub) and explain where they appear in the design."
    ),
]

synthesis_agent = Agent(
    name="FinalSynthesisAgent",
    instructions="""
    You are a senior reviewer synthesizing feedback from a panel of expert agents.

    Your task:
    1. **Prioritize key issues** raised across agents (e.g. missing requirements, major bottlenecks, unclear reasoning).
    2. Group similar or redundant feedback.
    3. Highlight:
      - Critical flaws (must fix)
      - Important but not blocking issues
      - Strengths worth keeping
    4. Write a short, clear summary (max 300 words) suitable for the interviewee.
    5. Use bullets and plain language. Be specific but brief.
    """
)



# =========================
# Core Routines
# =========================

async def run_vision(image_path: str) -> Dict[str, Any]:
    global _LAST_PARSED_DIAGRAM, _LAST_WHITEBOARD
    _LAST_PARSED_DIAGRAM = None
    _LAST_WHITEBOARD = None

    b64 = image_to_b64(image_path)
    result = await Runner.run(
        vision_agent,
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_image",
                        "detail": "auto",
                        "image_url": f"data:image/jpeg;base64,{b64}",
                    }
                ],
            },
            {
                "role": "user",
                "content": "Classify whiteboard (blank/has_content/none/unknown). If a diagram exists, extract it.",
            },
        ],
    )

    # Keep the text fallback if the tool wasn't called
    wb = _LAST_WHITEBOARD or _infer_whiteboard_state_from_text(result.final_output)

    out: Dict[str, Any] = {
        "summary": result.final_output,
        "whiteboard": wb,
    }
    if _LAST_PARSED_DIAGRAM is not None:
        out["diagram"] = json.loads(_LAST_PARSED_DIAGRAM.model_dump_json())
    else:
        out["diagram"] = None

    return out


async def run_assessments(document: str) -> Dict[str, Any]:
    """
    Run the assessment panel in parallel and the synthesis pass.
    Returns:
      {
        "assessments": { agentName: text, ... },
        "synthesis": "..."
      }
    """
    tasks = [Runner.run(agent, input=document) for agent in assessment_agents]
    results = await asyncio.gather(*tasks)

    assessments: Dict[str, str] = {}
    for agent, result in zip(assessment_agents, results):
        assessments[agent.name] = result.final_output

    combined_outputs = "\n\n".join(
        f"{agent.name}:\n{assessments[agent.name]}" for agent in assessment_agents
    )
    synthesis_result = await Runner.run(synthesis_agent, input=combined_outputs)

    return {
        "assessments": assessments,
        "synthesis": synthesis_result.final_output,
    }

async def run_live_coach(merged: str) -> Optional[Dict[str, Any]]:
    global _LAST_LIVE
    _LAST_LIVE = None
    result = await Runner.run(live_coach_agent, input=merged)
    return _LAST_LIVE.model_dump() if _LAST_LIVE else None

def load_text_file(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def build_merged_document(requirements: Optional[str],
                          diagram_summary: str,
                          transcript: Optional[str]) -> str:
    req_block = (requirements or "").strip()
    diag_block = (diagram_summary or "").strip()
    tx_block = (transcript or "").strip()

    return f"""
# ❗ Real Evaluation Requirements (not shared with the interviewee)
{req_block}

# 📸 System Architecture Summary (from diagram)
{diag_block}

# 🗣️ System Design Interview Transcript
{tx_block}
""".strip()

# =========================
# CLI
# =========================

async def run_cli(args):
    vision_out = await run_vision(args.image)
    assessments_blob: Optional[Dict[str, Any]] = None
    live_blob = None
    if args.transcript or args.requirements:
        transcript = load_text_file(args.transcript)
        requirements = load_text_file(args.requirements)
        merged = build_merged_document(requirements, vision_out["summary"], transcript)
        assessments_blob = await run_assessments(merged)
        live_blob = await run_live_coach(merged)

    final_payload: Dict[str, Any] = {
        "summary": vision_out["summary"],
        "whiteboard": vision_out.get("whiteboard"),    
        "diagram": vision_out.get("diagram"),
        "assessments": (assessments_blob or {}).get("assessments") if assessments_blob else None,
        "synthesis": (assessments_blob or {}).get("synthesis") if assessments_blob else None,
        "live": live_blob,
    }

    print(json.dumps(final_payload, ensure_ascii=False))

def main():
    p = argparse.ArgumentParser(description="Analyze an architecture diagram (and optionally a transcript+requirements) using the OpenAI Agents SDK.")
    p.add_argument("--image", required=True, help="Path to a diagram image (e.g., a screenshot .jpg/.png).")
    p.add_argument("--transcript", required=False, help="Path to transcript text file.")
    p.add_argument("--requirements", required=False, help="Path to requirements text file.")
    args = p.parse_args()

    # Basic sanity: ensure API key present (if your Agents SDK needs it via env var)
    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY is not set in the environment.", file=sys.stderr)
        sys.exit(2)

    try:
        asyncio.run(run_cli(args))
    except Exception as e:
        # Keep errors on stderr so stdout stays JSON-only when successful
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()