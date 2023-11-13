// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {ZKTree} from "./ZKTree.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IVerifier} from "./ZKTree.sol";
import {IHasher} from "./MerkleTreeWithHistory.sol";

contract Ballot is Ownable, ZKTree {
    event VouchInitialized(address[] candidates, uint timeout);
    event VouchFinished(address winner);

    enum Stage {
        NotStarted,
        Voting,
        Final
    }

    struct Candidate {
        address addr;
        bool isCandidate;
        uint88 vouchScore;
    }

    uint256 public deadline;

    // one slot packaging
    Stage public stage;
    uint248 public vouchScore;

    mapping(address => bool) public vouchers;
    mapping(address => bytes32) public vouchersCommitments;
    Candidate[] public currentCandidates;

    modifier hasVoted() {
        require(
            vouchersCommitments[msg.sender] != bytes32(0),
            "Ballot: voted already"
        );
        _;
    }

    modifier onlyVoucher() {
        require(vouchers[msg.sender], "Ballot: not a voucher");
        _;
    }

    modifier onlyStage(Stage _stage) {
        require(_stage == stage, "Ballot: wrong stage");
        _;
    }

    constructor(
        uint32 _levels,
        IHasher _hasher,
        IVerifier _verifier,
        address[] memory _vouchers
    ) ZKTree(_levels, _hasher, _verifier) {
        stage = Stage.NotStarted;
        uint256 i = 0;

        for (; i < _vouchers.length; ) {
            vouchers[_vouchers[i]] = true;

            unchecked {
                ++i;
            }
        }
    }

    function initBallot(
        address[] calldata _candidates,
        uint _timeout
    ) external onlyOwner onlyStage(Stage.NotStarted) {
        deadline = block.timestamp + _timeout;
        uint i = 0;
        for (; i < _candidates.length; ) {
            currentCandidates.push(Candidate(_candidates[i], true, 0));
            unchecked {
                ++i;
            }
        }

        stage = Stage.Voting;
        emit VouchInitialized(_candidates, _timeout);
    }

    function registerVouchCommitment(
        uint256 _commitment
    ) external onlyStage(Stage.Voting) {
        require(block.timestamp < deadline, "Ballot: timeout");
        _commit(bytes32(_commitment));
        vouchersCommitments[msg.sender] = bytes32(_commitment);
    }

    function revealVouches(
        uint256 _candidate,
        uint256 _nullifier,
        uint256 _root,
        uint[2] memory _proof_a,
        uint[2][2] memory _proof_b,
        uint[2] memory _proof_c
    ) external {
        require(block.timestamp > deadline, "Ballot: voting is not finished");
        _nullify(
            uint256(_candidate),
            bytes32(_nullifier),
            bytes32(_root),
            _proof_a,
            _proof_b,
            _proof_c
        );

        currentCandidates[_candidate].vouchScore += 1;
    }

    function finalizeStage() external onlyOwner {
        stage = Stage.Final;
    }

    function finalizeBallot() external onlyOwner onlyStage(Stage.Final) {
        uint maxScore;
        address winner;

        uint i = 0;
        for (; i < currentCandidates.length; ) {
            if (currentCandidates[i].vouchScore > maxScore) {
                maxScore = currentCandidates[i].vouchScore;
                winner = currentCandidates[i].addr;
            }

            delete currentCandidates[i];
            unchecked {
                ++i;
            }
        }

        vouchers[winner] = true;
        stage = Stage.NotStarted;

        emit VouchFinished(winner);
    }
}
